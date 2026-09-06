import type { Node, Edge } from '@/lib/db/schema'
import type { ApplyEventPayload } from '@/lib/sse/types'

// ============================================================
// Reducer puro de eventos de canvas (F4.1a)
//
// Extracción EXACTA del switch de `applyEvent` del store
// (store/canvas-store.ts). Misma idempotencia (dedupe por id),
// cascade al borrar nodo y reset de selección. Sin cambios
// semánticos: es el mismo reducer al que apuntan tanto el SSE
// (workspaces reales) como las mutaciones locales del demo
// (applyLocalEvent).
// ============================================================

export type CanvasStateSlice = {
  nodes: Node[]
  edges: Edge[]
  selectedNodeId: string | null
}

export function applyCanvasEvent(
  state: CanvasStateSlice,
  payload: ApplyEventPayload
): Partial<CanvasStateSlice> {
  const { event, data } = payload

  switch (event) {
    case 'node:created': {
      const node = data as Node
      // Evitar duplicados (idempotencia)
      if (state.nodes.some((n) => n.id === node.id)) return {}
      return { nodes: [...state.nodes, node] }
    }

    case 'node:updated': {
      const node = data as Node
      return {
        nodes: state.nodes.map((n) =>
          n.id === node.id ? { ...n, ...node } : n
        ),
      }
    }

    case 'node:deleted': {
      const { id } = data as { id: string; workspaceId: string }
      return {
        nodes: state.nodes.filter((n) => n.id !== id),
        edges: state.edges.filter((e) => e.sourceId !== id && e.targetId !== id),
        // Si el nodo borrado estaba seleccionado, deseleccionar
        selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
      }
    }

    case 'edge:created': {
      const edge = data as Edge
      if (state.edges.some((e) => e.id === edge.id)) return {}
      return { edges: [...state.edges, edge] }
    }

    case 'edge:updated': {
      const edge = data as Edge
      return {
        edges: state.edges.map((e) =>
          e.id === edge.id ? { ...e, ...edge } : e
        ),
      }
    }

    case 'edge:deleted': {
      const { id } = data as { id: string; workspaceId: string }
      return { edges: state.edges.filter((e) => e.id !== id) }
    }
  }
}