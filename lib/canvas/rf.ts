import type { Node as DBNode, Edge as DBEdge } from '@/lib/db/schema'
import type { Node as RFNode, Edge as RFEdge } from '@xyflow/react'
import { MarkerType } from '@xyflow/react'

// ============================================================
// Conversión pura store ↔ React Flow
// Zustand es la única fuente de verdad; estas funciones derivan
// la vista de React Flow (testables sin DOM).
// ============================================================

// Tipos REACT FLOW "data" que transportan el nodo/edge del dominio.
// No re-declaran campos; referencian el tipo inferido del schema.
export type CanvasNodeData = {
  domain: DBNode
  workspaceId: string
}

export type CanvasEdgeData = {
  domain: DBEdge
  workspaceId: string
}

export type CanvasRFNode = RFNode<CanvasNodeData, DBNode['type']>
export type CanvasRFEdge = RFEdge<CanvasEdgeData>

export function storeToRfNodes(
  nodes: DBNode[],
  workspaceId: string
): CanvasRFNode[] {
  return nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: { x: n.positionX, y: n.positionY },
    data: { domain: n, workspaceId },
    selected: false, // la selección la gobierna el store (selectedNodeId)
  }))
}

export function storeToRfEdges(
  edges: DBEdge[],
  workspaceId: string
): CanvasRFEdge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.sourceId,
    target: e.targetId,
    // 'related_to' usa el edge por defecto de RF; el resto usa el custom (F3.4b)
    type: e.type === 'related_to' ? e.type : 'custom',
    label: e.label ?? undefined,
    data: { domain: e, workspaceId },
    markerEnd: { type: MarkerType.ArrowClosed },
  }))
}

/**
 * Filtra edges cuyos source/target no estén entre los nodos vivos.
 * Defensa mínima contra edges huérfanos por paginación.
 */
export function filterOrphanEdges(edges: DBEdge[], nodes: DBNode[]): DBEdge[] {
  const ids = new Set(nodes.map((n) => n.id))
  return edges.filter((e) => ids.has(e.sourceId) && ids.has(e.targetId))
}
