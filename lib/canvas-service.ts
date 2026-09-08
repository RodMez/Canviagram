import { db } from '@/lib/db'
import { nodes, edges } from '@/lib/db/schema'
import { eq, and, isNull, or, asc } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { createNodeSchema, updateNodeSchema } from '@/lib/validators/node'
import { createEdgeSchema, updateEdgeSchema } from '@/lib/validators/edge'
import { publish } from '@/lib/sse/pubsub'
import { assertWorkspaceAccess, assertCanWrite } from '@/lib/auth/workspace-access'
import { ValidationError, NotFoundError, ForbiddenError, ConflictError } from '@/lib/errors'
import { positionForIndex, occupiedIndex, findFreeSlots } from '@/lib/canvas/layout'
import { getTemplateById } from '@/lib/templates/catalog'
import type { TemplateDefinition } from '@/lib/templates/catalog'

// Re-export errors for compatibility with routes importing from canvas-service
export { ValidationError, NotFoundError, ForbiddenError, ConflictError }

// ============================================================
// Helpers
// ============================================================

function handleZodError(error: unknown): never {
  if (error instanceof Error && 'issues' in error) {
    const zodError = error as { issues: unknown; message: string }
    throw new ValidationError(zodError.message, zodError.issues)
  }
  throw error as never
}

function clampLimit(limit: number | undefined): number {
  const v = limit ?? 50
  if (!Number.isFinite(v)) return 50
  return Math.min(Math.max(Math.trunc(v), 1), 100)
}

function clampOffset(offset: number | undefined): number {
  const v = offset ?? 0
  if (!Number.isFinite(v)) return 0
  return Math.max(Math.trunc(v), 0)
}

// ============================================================
// NODES
// ============================================================

export async function createNode(workspaceId: string, userId: string, input: unknown) {
  await assertCanWrite(workspaceId, userId)

  let parsed: ReturnType<typeof createNodeSchema.parse>
  try {
    parsed = createNodeSchema.parse(input)
  } catch (e) {
    handleZodError(e)
  }

  const id = uuidv4()
  const now = new Date()

  // Auto-layout (diseño 7): el servidor asigna la posición en grilla según el
  // PRIMER SLOT LIBRE (basado en posiciones reales, no en el conteo de nodos).
  // Conteo falla tras borrados/drag: reutiliza slots ocupados y los nodos se
  // solapan. Entradas positionX/Y se IGNORAN deliberadamente.
  const existingPositions = await db
    .select({ positionX: nodes.positionX, positionY: nodes.positionY })
    .from(nodes)
    .where(and(eq(nodes.workspaceId, workspaceId), isNull(nodes.deletedAt)))
    .all()
  const occupied = new Set(existingPositions.map((n) => occupiedIndex(n.positionX, n.positionY)))
  const [freeIndex] = findFreeSlots(occupied, 1)
  const slot = positionForIndex(freeIndex)

  const [inserted] = await db
    .insert(nodes)
    .values({
      id,
      workspaceId,
      createdBy: userId,
      type: parsed!.type,
      title: parsed!.title,
      content: parsed!.content ?? null,
      status: parsed!.status ?? null,
      positionX: slot.x,
      positionY: slot.y,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    .returning()

  publish(workspaceId, 'node:created', inserted ?? { id, workspaceId, ...parsed })

  return inserted ?? { id, workspaceId, createdBy: userId, ...parsed, createdAt: now, updatedAt: now, deletedAt: null }
}

export async function updateNode(
  workspaceId: string,
  nodeId: string,
  userId: string,
  input: unknown
) {
  await assertCanWrite(workspaceId, userId)

  let parsed: ReturnType<typeof updateNodeSchema.parse>
  try {
    parsed = updateNodeSchema.parse(input)
  } catch (e) {
    handleZodError(e)
  }

  const existing = await db
    .select()
    .from(nodes)
    .where(and(eq(nodes.id, nodeId), eq(nodes.workspaceId, workspaceId), isNull(nodes.deletedAt)))
    .get()

  if (!existing) {
    throw new NotFoundError('Nodo no encontrado')
  }

  const effectiveType = parsed!.type ?? existing.type
  const effectiveStatus = parsed!.status !== undefined ? parsed!.status : existing.status

  if (effectiveStatus && effectiveType !== 'task') {
    throw new ValidationError('Solo los nodos de tipo task pueden tener estado')
  }

  const now = new Date()

  const updateData: Record<string, unknown> = {
    updatedAt: now,
  }
  if (parsed!.type !== undefined) updateData.type = parsed!.type
  if (parsed!.title !== undefined) updateData.title = parsed!.title
  if (parsed!.content !== undefined) updateData.content = parsed!.content
  if (parsed!.status !== undefined) updateData.status = parsed!.status
  if (parsed!.positionX !== undefined) updateData.positionX = parsed!.positionX
  if (parsed!.positionY !== undefined) updateData.positionY = parsed!.positionY

  const [updated] = await db
    .update(nodes)
    .set(updateData as never)
    .where(and(eq(nodes.id, nodeId), eq(nodes.workspaceId, workspaceId)))
    .returning()

  publish(workspaceId, 'node:updated', updated ?? { id: nodeId, ...parsed })

  return updated
}

export async function softDeleteNode(workspaceId: string, nodeId: string, userId: string) {
  await assertCanWrite(workspaceId, userId)

  const existing = await db
    .select()
    .from(nodes)
    .where(and(eq(nodes.id, nodeId), eq(nodes.workspaceId, workspaceId), isNull(nodes.deletedAt)))
    .get()

  if (!existing) {
    throw new NotFoundError('Nodo no encontrado')
  }

  const now = new Date()

  // Transacción atómica: soft delete nodo + borrar edges huérfanos (source OR target)
  // better-sqlite3 transaction es síncrona: garantiza atomicidad sin fallback
  db.transaction((tx) => {
    tx.update(nodes)
      .set({ deletedAt: now, updatedAt: now } as never)
      .where(and(eq(nodes.id, nodeId), eq(nodes.workspaceId, workspaceId)))
      .run()
    tx.delete(edges)
      .where(and(eq(edges.workspaceId, workspaceId), or(eq(edges.sourceId, nodeId), eq(edges.targetId, nodeId))))
      .run()
  })

  // Recuperar nodo actualizado para respuesta y evento
  const deleted = await db
    .select()
    .from(nodes)
    .where(and(eq(nodes.id, nodeId), eq(nodes.workspaceId, workspaceId)))
    .get()

  publish(workspaceId, 'node:deleted', { id: nodeId, workspaceId })

  return deleted ?? { ...existing, deletedAt: now, updatedAt: now }
}

export async function listNodes(
  workspaceId: string,
  userId: string,
  options?: { limit?: number; offset?: number }
) {
  await assertWorkspaceAccess(workspaceId, userId, 'viewer')

  const limit = clampLimit(options?.limit)
  const offset = clampOffset(options?.offset)

  const result = await db
    .select()
    .from(nodes)
    .where(and(eq(nodes.workspaceId, workspaceId), isNull(nodes.deletedAt)))
    .orderBy(asc(nodes.createdAt))
    .limit(limit)
    .offset(offset)
    .all()

  return result
}

export async function getNodeById(workspaceId: string, nodeId: string, userId: string) {
  await assertWorkspaceAccess(workspaceId, userId, 'viewer')

  const node = await db
    .select()
    .from(nodes)
    .where(and(eq(nodes.id, nodeId), eq(nodes.workspaceId, workspaceId), isNull(nodes.deletedAt)))
    .get()

  if (!node) {
    throw new NotFoundError('Nodo no encontrado')
  }

  return node
}

// ============================================================
// EDGES
// ============================================================

export async function createEdge(workspaceId: string, userId: string, input: unknown) {
  await assertCanWrite(workspaceId, userId)

  let parsed: ReturnType<typeof createEdgeSchema.parse>
  try {
    parsed = createEdgeSchema.parse(input)
  } catch (e) {
    handleZodError(e)
  }

  if (parsed!.sourceId === parsed!.targetId) {
    throw new ValidationError('Un nodo no puede conectarse a sí mismo')
  }

  // Validación de source/target y creación dentro de transacción atómica
  // (better-sqlite3 sync): elimina el race entre validación e inserción
  const now = new Date()
  const id = uuidv4()

  db.transaction((tx) => {
    const source = tx
      .select()
      .from(nodes)
      .where(and(eq(nodes.id, parsed!.sourceId), eq(nodes.workspaceId, workspaceId), isNull(nodes.deletedAt)))
      .get()
    if (!source) throw new NotFoundError('Nodo origen no encontrado')
    const target = tx
      .select()
      .from(nodes)
      .where(and(eq(nodes.id, parsed!.targetId), eq(nodes.workspaceId, workspaceId), isNull(nodes.deletedAt)))
      .get()
    if (!target) throw new NotFoundError('Nodo destino no encontrado')
    tx.insert(edges)
      .values({
        id,
        workspaceId,
        createdBy: userId,
        sourceId: parsed!.sourceId,
        targetId: parsed!.targetId,
        type: parsed!.type,
        label: parsed!.label ?? null,
        createdAt: now,
      })
      .run()
  })

  // Recuperar la fila insertada para el evento y la respuesta
  const finalEdge = await db.select().from(edges).where(eq(edges.id, id)).get()

  publish(workspaceId, 'edge:created', finalEdge ?? { id, workspaceId, createdBy: userId, ...parsed, createdAt: now })

  return (finalEdge ?? {
    id,
    workspaceId,
    createdBy: userId,
    sourceId: parsed!.sourceId,
    targetId: parsed!.targetId,
    type: parsed!.type,
    label: parsed!.label ?? null,
    createdAt: now,
  }) as typeof edges.$inferSelect
}

export async function updateEdge(
  workspaceId: string,
  edgeId: string,
  userId: string,
  input: unknown
) {
  await assertCanWrite(workspaceId, userId)

  let parsed: ReturnType<typeof updateEdgeSchema.parse>
  try {
    parsed = updateEdgeSchema.parse(input)
  } catch (e) {
    handleZodError(e)
  }

  const existing = await db
    .select()
    .from(edges)
    .where(and(eq(edges.id, edgeId), eq(edges.workspaceId, workspaceId)))
    .get()

  if (!existing) {
    throw new NotFoundError('Conexión no encontrada')
  }

  const effectiveSource = (parsed!.sourceId as string | undefined) ?? existing.sourceId
  const effectiveTarget = (parsed!.targetId as string | undefined) ?? existing.targetId

  if (effectiveSource === effectiveTarget) {
    throw new ValidationError('Un nodo no puede conectarse a sí mismo')
  }

  if (parsed!.sourceId) {
    const source = await db
      .select()
      .from(nodes)
      .where(and(eq(nodes.id, parsed!.sourceId), eq(nodes.workspaceId, workspaceId), isNull(nodes.deletedAt)))
      .get()
    if (!source) throw new NotFoundError('Nodo origen no encontrado')
  }

  if (parsed!.targetId) {
    const target = await db
      .select()
      .from(nodes)
      .where(and(eq(nodes.id, parsed!.targetId), eq(nodes.workspaceId, workspaceId), isNull(nodes.deletedAt)))
      .get()
    if (!target) throw new NotFoundError('Nodo destino no encontrado')
  }

  const updateData: Record<string, unknown> = {}
  if (parsed!.type !== undefined) updateData.type = parsed!.type
  if (parsed!.label !== undefined) updateData.label = parsed!.label
  if (parsed!.sourceId !== undefined) updateData.sourceId = parsed!.sourceId
  if (parsed!.targetId !== undefined) updateData.targetId = parsed!.targetId

  if (Object.keys(updateData).length === 0) {
    return existing
  }

  const [updated] = await db
    .update(edges)
    .set(updateData as never)
    .where(and(eq(edges.id, edgeId), eq(edges.workspaceId, workspaceId)))
    .returning()

  publish(workspaceId, 'edge:updated', updated ?? { id: edgeId, ...parsed })

  return updated
}

export async function deleteEdge(workspaceId: string, edgeId: string, userId: string) {
  await assertCanWrite(workspaceId, userId)

  const existing = await db
    .select()
    .from(edges)
    .where(and(eq(edges.id, edgeId), eq(edges.workspaceId, workspaceId)))
    .get()

  if (!existing) {
    throw new NotFoundError('Conexión no encontrada')
  }

  await db.delete(edges).where(and(eq(edges.id, edgeId), eq(edges.workspaceId, workspaceId)))

  publish(workspaceId, 'edge:deleted', { id: edgeId, workspaceId })

  return existing
}

export async function listEdges(
  workspaceId: string,
  userId: string,
  options?: { limit?: number; offset?: number }
) {
  await assertWorkspaceAccess(workspaceId, userId, 'viewer')

  const limit = clampLimit(options?.limit)
  const offset = clampOffset(options?.offset)

  const result = await db
    .select()
    .from(edges)
    .where(eq(edges.workspaceId, workspaceId))
    .orderBy(asc(edges.createdAt))
    .limit(limit)
    .offset(offset)
    .all()
  return result
}

export async function getWorkspaceGraph(workspaceId: string, userId: string) {
  await assertWorkspaceAccess(workspaceId, userId, 'viewer')

  // Listar con paginación amplia interna pero respetando límite default
  // Para graph queremos todos los nodos vivos hasta límite, luego filtrar edges huérfanos
  const [allNodes, allEdges] = await Promise.all([
    listNodes(workspaceId, userId, { limit: 100, offset: 0 }),
    listEdges(workspaceId, userId, { limit: 100, offset: 0 }),
  ])

  // Si hay más de 100, necesitaríamos paginar; para MVP filtramos in-memory los primeros 100
  // Mejor: si graph excede límite, retornamos lo que cabe; especificación indica filtrar con Set
  const aliveIds = new Set(allNodes.map((n) => n.id))
  const filteredEdges = allEdges.filter((e) => aliveIds.has(e.sourceId) && aliveIds.has(e.targetId))

  return { nodes: allNodes, edges: filteredEdges }
}

// ============================================================
// LAYOUT / TEMPLATES
// ============================================================

/**
 * Reordena todo el grafo activo del workspace a una grilla limpia.
 * Capas por profundidad (longest-path sobre parent_of/depends_on en dirección
 * source→target), así proyectos y dependencias quedan adyacentes; los nodos
 * sin conexiones van tras los conectados (ordenados por createdAt).
 * Publica node:updated por nodo para sincronizar todos los clientes SSE.
 */
export async function relayoutWorkspace(workspaceId: string, userId: string) {
  await assertCanWrite(workspaceId, userId)

  const allNodes = await db
    .select()
    .from(nodes)
    .where(and(eq(nodes.workspaceId, workspaceId), isNull(nodes.deletedAt)))
    .all()
  const allEdges = await db.select().from(edges).where(eq(edges.workspaceId, workspaceId)).all()

  if (allNodes.length === 0) {
    return { repositioned: 0 }
  }

  // Longest-path layering: rank[target] = max(rank[target], rank[source] + 1)
  const rank = new Map<string, number>()
  for (const n of allNodes) rank.set(n.id, 0)
  for (let i = 0; i < allNodes.length; i++) {
    let changed = false
    for (const e of allEdges) {
      const sourceRank = rank.get(e.sourceId)
      const targetRank = rank.get(e.targetId)
      if (sourceRank !== undefined && targetRank !== undefined && targetRank < sourceRank + 1) {
        rank.set(e.targetId, sourceRank + 1)
        changed = true
      }
    }
    if (!changed) break
  }

  const sorted = [...allNodes].sort((a, b) => {
    const rankDiff = (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)
    if (rankDiff !== 0) return rankDiff
    return (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0)
  })

  const now = new Date()
  db.transaction((tx) => {
    sorted.forEach((node, i) => {
      const pos = positionForIndex(i)
      tx.update(nodes)
        .set({ positionX: pos.x, positionY: pos.y, updatedAt: now } as never)
        .where(and(eq(nodes.id, node.id), eq(nodes.workspaceId, workspaceId)))
        .run()
    })
  })

  const updated = await db
    .select()
    .from(nodes)
    .where(and(eq(nodes.workspaceId, workspaceId), isNull(nodes.deletedAt)))
    .all()
  for (const n of updated) publish(workspaceId, 'node:updated', n)

  return { repositioned: updated.length }
}

type InsertedTemplateNode = {
  id: string
  workspaceId: string
  createdBy: string
  type: TemplateDefinition['nodes'][number]['type']
  title: string
  content: string | null
  status: typeof nodes.$inferSelect.status
  positionX: number
  positionY: number
  createdAt: Date
  updatedAt: Date
  deletedAt: null
}

/**
 * Materializa un template del catálogo en ZONA LIBRE del canvas: reserva un
 * bloque contiguo de slots desocupados y crea nodos + edges en una transacción
 * atómica, publicando node:created/edge:created por elemento.
 */
export async function applyTemplate(workspaceId: string, userId: string, templateId: string) {
  await assertCanWrite(workspaceId, userId)

  const template = getTemplateById(templateId)
  if (!template) {
    throw new NotFoundError('Template no encontrado')
  }

  const existingPositions = await db
    .select({ positionX: nodes.positionX, positionY: nodes.positionY })
    .from(nodes)
    .where(and(eq(nodes.workspaceId, workspaceId), isNull(nodes.deletedAt)))
    .all()
  const occupied = new Set(existingPositions.map((n) => occupiedIndex(n.positionX, n.positionY)))
  const freeSlots = findFreeSlots(occupied, template.nodes.length)

  const now = new Date()
  const idsByTemplateIndex = new Map<number, string>()
  const createdNodes: InsertedTemplateNode[] = []
  const createdEdges: Array<typeof edges.$inferSelect> = []

  db.transaction((tx) => {
    template.nodes.forEach((def, i) => {
      const id = uuidv4()
      idsByTemplateIndex.set(i, id)
      const pos = positionForIndex(freeSlots[i])
      const node: InsertedTemplateNode = {
        id,
        workspaceId,
        createdBy: userId,
        type: def.type,
        title: def.title,
        content: def.content ?? null,
        status: def.status ?? null,
        positionX: pos.x,
        positionY: pos.y,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }
      tx.insert(nodes)
        .values(node)
        .run()
      createdNodes.push(node)
    })

    template.edges.forEach((def) => {
      const sourceId = idsByTemplateIndex.get(def.source)
      const targetId = idsByTemplateIndex.get(def.target)
      if (!sourceId || !targetId) {
        throw new ConflictError('Template inválido: edge referencia un nodo inexistente')
      }
      const id = uuidv4()
      const edge: typeof edges.$inferSelect = {
        id,
        workspaceId,
        createdBy: userId,
        sourceId,
        targetId,
        type: def.type,
        label: def.label ?? null,
        createdAt: now,
      }
      tx.insert(edges)
        .values(edge)
        .run()
      createdEdges.push(edge)
    })
  })

  for (const n of createdNodes) publish(workspaceId, 'node:created', n)
  for (const e of createdEdges) publish(workspaceId, 'edge:created', e)

  return { template: template.id, nodes: createdNodes, edges: createdEdges }
}
