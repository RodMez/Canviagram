import { db } from '@/lib/db'
import { nodes, edges, boardColumns, users, workspaces, workspaceMembers, type RecurrenceRule } from '@/lib/db/schema'
import { eq, and, isNull, or, asc, desc, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { createNodeSchema, updateNodeSchema } from '@/lib/validators/node'
import { createEdgeSchema, updateEdgeSchema } from '@/lib/validators/edge'
import { publish } from '@/lib/sse/pubsub'
import { assertWorkspaceAccess, assertCanWrite } from '@/lib/auth/workspace-access'
import { ValidationError, NotFoundError, ForbiddenError, ConflictError, UnprocessableError } from '@/lib/errors'
import { positionForIndex, occupiedIndex, findFreeSlots } from '@/lib/canvas/layout'
import { computeDagreLayout } from '@/lib/canvas/dagre-layout'

// Re-export errors for compatibility with routes importing from canvas-service
export { ValidationError, NotFoundError, ForbiddenError, ConflictError, UnprocessableError }

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

// Cross-workspace checks (422, no 404): el recurso existe pero no pertenece.
async function assertAssigneeForWorkspace(workspaceId: string, assigneeId: string): Promise<void> {
  const user = await db.select({ id: users.id }).from(users).where(eq(users.id, assigneeId)).get()
  if (!user) throw new UnprocessableError('El responsable no existe')
  const ws = await db
    .select({ ownerId: workspaces.ownerId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .get()
  if (ws?.ownerId === assigneeId) return
  const membership = await db
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, assigneeId)))
    .get()
  if (!membership) throw new UnprocessableError('El responsable no pertenece a este workspace')
}

async function assertBoardColumnForWorkspace(workspaceId: string, columnId: string): Promise<void> {
  const col = await db.select().from(boardColumns).where(eq(boardColumns.id, columnId)).get()
  if (!col) throw new NotFoundError('Columna no encontrada')
  if (col.workspaceId !== workspaceId) {
    throw new UnprocessableError('La columna no pertenece a este workspace')
  }
}

function assertTaskOnlyFields(
  effectiveType: string,
  parsed: { priority?: unknown; effort?: unknown; assigneeId?: unknown; boardColumnId?: unknown; status?: unknown }
): void {
  if (effectiveType !== 'task') {
    const offenders: Array<[string, unknown]> = [
      ['priority', parsed.priority],
      ['effort', parsed.effort],
      ['assigneeId', parsed.assigneeId],
      ['boardColumnId', parsed.boardColumnId],
    ]
    for (const [field, value] of offenders) {
      if (value !== undefined && value !== null) {
        throw new ValidationError(`Solo los nodos de tipo task pueden tener ${field}`)
      }
    }
  }
}

// ============================================================
// Recordatorios (Fase 3)
// ============================================================

/** Offset por defecto (min) cuando se fija dueDate sin recordatorio explícito: 15 min. */
export const DEFAULT_REMINDER_OFFSET_MIN = 15

/**
 * Resuelve dueDate/reminderOffsetMin/recurrenceRule para insert/update.
 * - Si se fija dueDate y no hay offset, usa el default (15 min antes).
 * - Si cambia dueDate u offset, reinicia notifiedAt para re-armar el sweep.
 * - Sin dueDate no hay recurrencia: borrar la fecha (dueDate null) limpia
 *   recurrenceRule (F5.3).
 */
export function resolveReminderFields(
  parsed: { dueDate?: number | null; reminderOffsetMin?: number | null; recurrenceRule?: RecurrenceRule | null },
  existing: { dueDate: Date | null; reminderOffsetMin: number | null; notifiedAt: Date | null; recurrenceRule?: RecurrenceRule | null }
): { dueDate: Date | null; reminderOffsetMin: number | null; notifiedAt: Date | null; recurrenceRule: RecurrenceRule | null } {
  const dueMs = parsed.dueDate !== undefined ? parsed.dueDate : existing.dueDate?.getTime() ?? null
  let offset = parsed.reminderOffsetMin !== undefined ? parsed.reminderOffsetMin : existing.reminderOffsetMin

  if (dueMs != null && offset == null) {
    offset = DEFAULT_REMINDER_OFFSET_MIN
  }

  // Recurrencia sin fecha base no tiene sentido: se limpia junto con dueDate.
  const recurrenceRule =
    dueMs == null ? null : (parsed.recurrenceRule !== undefined ? parsed.recurrenceRule : (existing.recurrenceRule ?? null))

  const effectiveDueChanged =
    parsed.dueDate !== undefined && (parsed.dueDate ?? null) !== (existing.dueDate?.getTime() ?? null)
  const effectiveOffsetChanged =
    parsed.reminderOffsetMin !== undefined &&
    (parsed.reminderOffsetMin ?? null) !== existing.reminderOffsetMin

  return {
    dueDate: dueMs != null ? new Date(dueMs) : null,
    reminderOffsetMin: offset,
    notifiedAt: effectiveDueChanged || effectiveOffsetChanged ? null : existing.notifiedAt,
    recurrenceRule,
  }
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

  const reminder = resolveReminderFields(parsed!, {
    dueDate: null,
    reminderOffsetMin: null,
    notifiedAt: null,
    recurrenceRule: null,
  })

  assertTaskOnlyFields(parsed!.type, parsed! as Record<string, unknown>)
  if (parsed!.assigneeId) {
    await assertAssigneeForWorkspace(workspaceId, parsed!.assigneeId)
  }
  let boardColumnId: string | null = parsed!.boardColumnId ?? null
  let boardOrder = 0
  if (boardColumnId) {
    await assertBoardColumnForWorkspace(workspaceId, boardColumnId)
    const maxRow = await db
      .select({ m: sql<number | null>`max(${nodes.boardOrder})` })
      .from(nodes)
      .where(and(eq(nodes.workspaceId, workspaceId), eq(nodes.boardColumnId, boardColumnId)))
      .get()
    boardOrder = (Number((maxRow as { m: number | null } | undefined)?.m) || 0) + 1000
    if (!Number.isFinite(boardOrder)) boardOrder = 1000
  }

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
      priority: parsed!.priority ?? null,
      effort: parsed!.effort ?? null,
      assigneeId: parsed!.assigneeId ?? null,
      boardColumnId,
      boardOrder,
      dueDate: reminder.dueDate,
      reminderOffsetMin: reminder.reminderOffsetMin,
      notifiedAt: null,
      recurrenceRule: reminder.recurrenceRule,
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
  assertTaskOnlyFields(effectiveType, parsed! as Record<string, unknown>)

  // Cross-workspace 422: assignee debe pertenecer al workspace; columna al workspace.
  if (parsed!.assigneeId !== undefined && parsed!.assigneeId !== null) {
    await assertAssigneeForWorkspace(workspaceId, parsed!.assigneeId)
  }
  if (parsed!.boardColumnId !== undefined && parsed!.boardColumnId !== null) {
    await assertBoardColumnForWorkspace(workspaceId, parsed!.boardColumnId)
  }

  const now = new Date()

  const reminder = resolveReminderFields(parsed!, {
    dueDate: existing.dueDate,
    reminderOffsetMin: existing.reminderOffsetMin,
    notifiedAt: existing.notifiedAt,
    recurrenceRule: existing.recurrenceRule,
  })

  // El schema valida recurrencia↔dueDate dentro del payload; aquí se valida
  // contra el estado efectivo (dueDate puede venir del nodo existente).
  if (reminder.recurrenceRule && !reminder.dueDate) {
    throw new ValidationError('La recurrencia requiere una fecha límite (dueDate)')
  }

  const updateData: Record<string, unknown> = {
    updatedAt: now,
  }
  if (parsed!.type !== undefined) updateData.type = parsed!.type
  if (parsed!.title !== undefined) updateData.title = parsed!.title
  if (parsed!.content !== undefined) updateData.content = parsed!.content
  if (parsed!.status !== undefined) updateData.status = parsed!.status
  if (parsed!.priority !== undefined) updateData.priority = parsed!.priority
  if (parsed!.effort !== undefined) updateData.effort = parsed!.effort
  if (parsed!.assigneeId !== undefined) updateData.assigneeId = parsed!.assigneeId
  if (parsed!.boardColumnId !== undefined) updateData.boardColumnId = parsed!.boardColumnId
  if (parsed!.positionX !== undefined) updateData.positionX = parsed!.positionX
  if (parsed!.positionY !== undefined) updateData.positionY = parsed!.positionY
  if ((reminder.dueDate?.getTime() ?? null) !== (existing.dueDate?.getTime() ?? null)) {
    updateData.dueDate = reminder.dueDate
  }
  if (reminder.reminderOffsetMin !== existing.reminderOffsetMin) {
    updateData.reminderOffsetMin = reminder.reminderOffsetMin
  }
  if (reminder.notifiedAt !== existing.notifiedAt) updateData.notifiedAt = reminder.notifiedAt
  if ((reminder.recurrenceRule ?? null) !== (existing.recurrenceRule ?? null)) {
    updateData.recurrenceRule = reminder.recurrenceRule
  }

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

export const NODE_LIST_SORTS = ['createdAt', 'updatedAt', 'title', 'priority', 'effort', 'boardOrder'] as const
export type NodeListSort = (typeof NODE_LIST_SORTS)[number]

export type ListNodesOptions = {
  limit?: number
  offset?: number
  assigneeId?: string
  priority?: string
  boardColumnId?: string
  sort?: NodeListSort
  dir?: 'asc' | 'desc'
}

const PRIORITY_ORDER_CASE = sql`CASE ${nodes.priority} WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END`

export async function listNodes(
  workspaceId: string,
  userId: string,
  options?: ListNodesOptions
) {
  await assertWorkspaceAccess(workspaceId, userId, 'viewer')

  const limit = clampLimit(options?.limit)
  const offset = clampOffset(options?.offset)

  const conditions = [eq(nodes.workspaceId, workspaceId), isNull(nodes.deletedAt)]
  if (options?.assigneeId) {
    conditions.push(eq(nodes.assigneeId, options.assigneeId))
  }
  if (options?.priority) {
    conditions.push(eq(nodes.priority, options.priority as never))
  }
  if (options?.boardColumnId) {
    conditions.push(eq(nodes.boardColumnId, options.boardColumnId))
  }

  const sort = NODE_LIST_SORTS.includes(options?.sort as NodeListSort)
    ? (options!.sort as NodeListSort)
    : 'createdAt'
  const dir = options?.dir === 'desc' ? 'desc' : 'asc'
  const orderExpr = (expr: unknown) => (dir === 'desc' ? desc(expr as never) : asc(expr as never))

  let orderBy: ReturnType<typeof asc>
  switch (sort) {
    case 'title':
      orderBy = orderExpr(nodes.title)
      break
    case 'updatedAt':
      orderBy = orderExpr(nodes.updatedAt)
      break
    case 'priority':
      orderBy = orderExpr(PRIORITY_ORDER_CASE)
      break
    case 'effort':
      orderBy = orderExpr(nodes.effort)
      break
    case 'boardOrder':
      orderBy = orderExpr(nodes.boardOrder)
      break
    case 'createdAt':
    default:
      orderBy = orderExpr(nodes.createdAt)
      break
  }

  const result = await db
    .select()
    .from(nodes)
    .where(and(...conditions))
    .orderBy(orderBy)
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
// LAYOUT
// ============================================================

/**
 * Reordena todo el grafo activo del workspace con un layout jerárquico
 * (dagre, F5.2): los edges dirigidos (depends_on / parent_of) definen el
 * rank, así lo relacionado queda agrupado y las dependencias fluyen de
 * arriba hacia abajo. Publica node:updated por nodo para sincronizar
 * todos los clientes SSE.
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

  const positions = computeDagreLayout(
    allNodes.map((n) => n.id),
    allEdges.map((e) => ({ sourceId: e.sourceId, targetId: e.targetId }))
  )

  const now = new Date()
  db.transaction((tx) => {
    for (const node of allNodes) {
      const pos = positions.get(node.id)!
      tx.update(nodes)
        .set({ positionX: pos.x, positionY: pos.y, updatedAt: now } as never)
        .where(and(eq(nodes.id, node.id), eq(nodes.workspaceId, workspaceId)))
        .run()
    }
  })

  const updated = await db
    .select()
    .from(nodes)
    .where(and(eq(nodes.workspaceId, workspaceId), isNull(nodes.deletedAt)))
    .all()
  for (const n of updated) publish(workspaceId, 'node:updated', n)

  return { repositioned: updated.length }
}
