import { db } from '@/lib/db'
import { nodes, edges } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { createNodeSchema, updateNodeSchema } from '@/lib/validators/node'
import { createEdgeSchema, updateEdgeSchema } from '@/lib/validators/edge'
import { publish } from '@/lib/sse/pubsub'

// ============================================================
// Errores de dominio
// ============================================================

export class ValidationError extends Error {
  statusCode = 400
  details?: unknown
  constructor(message: string, details?: unknown) {
    super(message)
    this.name = 'ValidationError'
    this.details = details
  }
}

export class NotFoundError extends Error {
  statusCode = 404
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class ForbiddenError extends Error {
  statusCode = 403
  constructor(message: string) {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export class ConflictError extends Error {
  statusCode = 409
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

// ============================================================
// Helpers
// ============================================================

function handleZodError(error: unknown): never {
  if (error instanceof Error && 'issues' in error) {
    // ZodError
    const zodError = error as { issues: unknown; message: string }
    throw new ValidationError(zodError.message, zodError.issues)
  }
  throw error
}

// ============================================================
// NODES
// ============================================================

export async function createNode(
  workspaceId: string,
  userId: string,
  input: unknown
) {
  let parsed: ReturnType<typeof createNodeSchema.parse>
  try {
    parsed = createNodeSchema.parse(input)
  } catch (e) {
    handleZodError(e)
  }

  const id = uuidv4()
  const now = new Date()

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
      positionX: parsed!.positionX ?? 0,
      positionY: parsed!.positionY ?? 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    .returning()

  // publish post-commit
  publish(workspaceId, 'node:created', inserted ?? { id, workspaceId, ...parsed })

  return inserted ?? { id, workspaceId, createdBy: userId, ...parsed, createdAt: now, updatedAt: now, deletedAt: null }
}

export async function updateNode(
  workspaceId: string,
  nodeId: string,
  _userId: string,
  input: unknown
) {
  let parsed: ReturnType<typeof updateNodeSchema.parse>
  try {
    parsed = updateNodeSchema.parse(input)
  } catch (e) {
    handleZodError(e)
  }

  // Buscar nodo existente con filtro deleted_at IS NULL
  const existing = await db
    .select()
    .from(nodes)
    .where(and(eq(nodes.id, nodeId), eq(nodes.workspaceId, workspaceId), isNull(nodes.deletedAt)))
    .get()

  if (!existing) {
    throw new NotFoundError('Nodo no encontrado')
  }

  // Re-validación defensiva: status solo si el tipo resultante es task
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

export async function softDeleteNode(
  workspaceId: string,
  nodeId: string,
  _userId: string
) {
  const existing = await db
    .select()
    .from(nodes)
    .where(and(eq(nodes.id, nodeId), eq(nodes.workspaceId, workspaceId), isNull(nodes.deletedAt)))
    .get()

  if (!existing) {
    throw new NotFoundError('Nodo no encontrado')
  }

  const now = new Date()

  const [deleted] = await db
    .update(nodes)
    .set({ deletedAt: now, updatedAt: now } as never)
    .where(and(eq(nodes.id, nodeId), eq(nodes.workspaceId, workspaceId)))
    .returning()

  publish(workspaceId, 'node:deleted', { id: nodeId, workspaceId })

  return deleted
}

export async function listNodes(workspaceId: string) {
  const result = await db
    .select()
    .from(nodes)
    .where(and(eq(nodes.workspaceId, workspaceId), isNull(nodes.deletedAt)))
    .all()

  return result
}

export async function getNodeById(workspaceId: string, nodeId: string) {
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

export async function createEdge(
  workspaceId: string,
  userId: string,
  input: unknown
) {
  let parsed: ReturnType<typeof createEdgeSchema.parse>
  try {
    parsed = createEdgeSchema.parse(input)
  } catch (e) {
    handleZodError(e)
  }

  // Validar que source y target existen y pertenecen al workspace y no están borrados
  const source = await db
    .select()
    .from(nodes)
    .where(and(eq(nodes.id, parsed!.sourceId), eq(nodes.workspaceId, workspaceId), isNull(nodes.deletedAt)))
    .get()

  if (!source) {
    throw new NotFoundError('Nodo origen no encontrado')
  }

  const target = await db
    .select()
    .from(nodes)
    .where(and(eq(nodes.id, parsed!.targetId), eq(nodes.workspaceId, workspaceId), isNull(nodes.deletedAt)))
    .get()

  if (!target) {
    throw new NotFoundError('Nodo destino no encontrado')
  }

  // self-loop ya validado por Zod, pero doble check defensivo
  if (parsed!.sourceId === parsed!.targetId) {
    throw new ValidationError('Un nodo no puede conectarse a sí mismo')
  }

  const id = uuidv4()
  const now = new Date()

  const [inserted] = await db
    .insert(edges)
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
    .returning()

  publish(workspaceId, 'edge:created', inserted ?? { id, workspaceId, ...parsed })

  return inserted ?? { id, workspaceId, createdBy: userId, ...parsed, createdAt: now }
}

export async function updateEdge(
  workspaceId: string,
  edgeId: string,
  _userId: string,
  input: unknown
) {
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

  // Si cambian source/target, validar existencia y self-loop
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

export async function deleteEdge(
  workspaceId: string,
  edgeId: string,
  _userId: string
) {
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

export async function listEdges(workspaceId: string) {
  const result = await db.select().from(edges).where(eq(edges.workspaceId, workspaceId)).all()
  return result
}

export async function getWorkspaceGraph(workspaceId: string) {
  const [allNodes, allEdges] = await Promise.all([listNodes(workspaceId), listEdges(workspaceId)])
  return { nodes: allNodes, edges: allEdges }
}
