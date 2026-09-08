import type { Node, Edge } from '@/lib/db/schema'
import { createNodeSchema, updateNodeSchema, createEdgeSchema } from '@/lib/validators'
import { ValidationError, NotFoundError } from '@/lib/errors'
import { demoId, DEMO_WORKSPACE_ID, DEMO_CREATED_AT } from '@/lib/demo/fixtures'

// ============================================================
// Ops de grafo en memoria para la DEMO (F4.1b)
//
// Mismas validaciones que producción (createNodeSchema /
// createEdgeSchema / updateNodeSchema de lib/validators) pero
// operando sobre un DemoGraph puro en RAM. El server del chat
// clona el grafo del body POR REQUEST y estas ops lo mutan;
// nada sobrevive entre requests (cero estado compartido).
// ============================================================

export type DemoGraph = {
  nodes: Node[]
  edges: Edge[]
}

// Convierte errores de zod a ValidationError (mismo contrato que
// canvas-service en producción: 400 con mensaje del schema).
function handleZodError(error: unknown): never {
  if (error instanceof Error && 'issues' in error) {
    const zodError = error as { issues: unknown; message: string }
    throw new ValidationError(zodError.message, zodError.issues)
  }
  throw error as never
}

/** Clona el grafo (arrays y objetos nuevos): el server nunca comparte referencias. */
export function cloneGraph(graph: DemoGraph): DemoGraph {
  return {
    nodes: graph.nodes.map((n) => ({ ...n })),
    edges: graph.edges.map((e) => ({ ...e })),
  }
}

export function createNode(graph: DemoGraph, input: unknown): Node {
  let parsed: ReturnType<typeof createNodeSchema.parse>
  try {
    parsed = createNodeSchema.parse(input)
  } catch (e) {
    handleZodError(e)
  }
  const node: Node = {
    id: demoId('n'),
    workspaceId: DEMO_WORKSPACE_ID,
    createdBy: 'demo',
    type: parsed!.type,
    title: parsed!.title,
    content: parsed!.content ?? null,
    status: parsed!.status ?? null,
    dueDate: null,
    reminderOffsetMin: null,
    notifiedAt: null,
    positionX: parsed!.positionX ?? 0,
    positionY: parsed!.positionY ?? 0,
    createdAt: DEMO_CREATED_AT,
    updatedAt: DEMO_CREATED_AT,
    deletedAt: null,
  }
  graph.nodes.push(node)
  return node
}

export function updateNode(graph: DemoGraph, nodeId: string, input: unknown): Node {
  let parsed: ReturnType<typeof updateNodeSchema.parse>
  try {
    parsed = updateNodeSchema.parse(input)
  } catch (e) {
    handleZodError(e)
  }
  const existing = graph.nodes.find((n) => n.id === nodeId)
  if (!existing) throw new NotFoundError('Nodo no encontrado')

  const effectiveType = parsed!.type ?? existing.type
  const effectiveStatus = parsed!.status !== undefined ? parsed!.status : existing.status
  if (effectiveStatus && effectiveType !== 'task') {
    throw new ValidationError('Solo los nodos de tipo task pueden tener estado')
  }

  const updated: Node = {
    ...existing,
    type: effectiveType,
    title: parsed!.title ?? existing.title,
    content: parsed!.content !== undefined ? parsed!.content : existing.content,
    status: effectiveStatus,
    positionX: parsed!.positionX ?? existing.positionX,
    positionY: parsed!.positionY ?? existing.positionY,
    updatedAt: DEMO_CREATED_AT,
  }
  graph.nodes = graph.nodes.map((n) => (n.id === nodeId ? updated : n))
  return updated
}

export function deleteNode(
  graph: DemoGraph,
  nodeId: string
): { success: true; nodeId: string; removedEdgeIds: string[] } {
  const exists = graph.nodes.some((n) => n.id === nodeId)
  if (!exists) throw new NotFoundError('Nodo no encontrado')

  const removedEdgeIds = graph.edges
    .filter((e) => e.sourceId === nodeId || e.targetId === nodeId)
    .map((e) => e.id)
  graph.nodes = graph.nodes.filter((n) => n.id !== nodeId)
  graph.edges = graph.edges.filter((e) => e.sourceId !== nodeId && e.targetId !== nodeId)
  return { success: true, nodeId, removedEdgeIds }
}

export function createEdge(graph: DemoGraph, input: unknown): Edge {
  let parsed: ReturnType<typeof createEdgeSchema.parse>
  try {
    parsed = createEdgeSchema.parse(input)
  } catch (e) {
    handleZodError(e)
  }
  const source = graph.nodes.find((n) => n.id === parsed!.sourceId)
  if (!source) throw new NotFoundError('Nodo origen no encontrado')
  const target = graph.nodes.find((n) => n.id === parsed!.targetId)
  if (!target) throw new NotFoundError('Nodo destino no encontrado')

  const edge: Edge = {
    id: demoId('e'),
    workspaceId: DEMO_WORKSPACE_ID,
    createdBy: 'demo',
    sourceId: parsed!.sourceId,
    targetId: parsed!.targetId,
    type: parsed!.type,
    label: parsed!.label ?? null,
    createdAt: DEMO_CREATED_AT,
  }
  graph.edges.push(edge)
  return edge
}

export function deleteEdge(
  graph: DemoGraph,
  edgeId: string
): { success: true; edgeId: string } {
  const exists = graph.edges.some((e) => e.id === edgeId)
  if (!exists) throw new NotFoundError('Conexión no encontrada')
  graph.edges = graph.edges.filter((e) => e.id !== edgeId)
  return { success: true, edgeId }
}

export function queryGraph(graph: DemoGraph): { nodes: Node[]; edges: Edge[] } {
  return { nodes: graph.nodes, edges: graph.edges }
}