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

// ============================================================
// Normalización de fechas (fix crash `dueDate.getTime is not a function`)
// SQLite integer -> Drizzle Date en server -> NextResponse.json / SSE
// JSON.stringify -> string ISO en cliente. El type dice Date|null pero
// en runtime puede ser string: se normaliza a Date en la frontera del
// store (loadGraph + eventos SSE), punto único que cubre fetch y SSE.
// Idempotente: Date válido se conserva tal cual (demo y drag locales).
// Nunca lanza: valor inválido -> null (o se conserva el original en los
// campos no-nulos createdAt/updatedAt para no corromper el type).
// ============================================================

function toDateOrNull(value: unknown): Date | null {
  if (value == null) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  if (typeof value === 'number' || typeof value === 'string') {
    if (typeof value === 'string' && value.trim() === '') return null
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  return null
}

function isNullOrValidDate(value: unknown): boolean {
  return value === null || (value instanceof Date && !Number.isNaN(value.getTime()))
}

export function normalizeNodeDates(node: Node): Node {
  // Fast path: preserva identidad referencial si ya son Date|null válidos
  // (demo, drag locales y tests de identidad; evita re-renders espurios).
  if (
    isNullOrValidDate(node.dueDate) &&
    isNullOrValidDate(node.notifiedAt) &&
    isNullOrValidDate(node.deletedAt) &&
    node.createdAt instanceof Date &&
    !Number.isNaN(node.createdAt.getTime()) &&
    node.updatedAt instanceof Date &&
    !Number.isNaN(node.updatedAt.getTime())
  ) {
    return node
  }
  return {
    ...node,
    dueDate: toDateOrNull(node.dueDate),
    notifiedAt: toDateOrNull(node.notifiedAt),
    deletedAt: toDateOrNull(node.deletedAt),
    createdAt: toDateOrNull(node.createdAt) ?? node.createdAt,
    updatedAt: toDateOrNull(node.updatedAt) ?? node.updatedAt,
  }
}

export function normalizeEdgeDates(edge: Edge): Edge {
  if (edge.createdAt instanceof Date && !Number.isNaN(edge.createdAt.getTime())) {
    return edge
  }
  return {
    ...edge,
    createdAt: toDateOrNull(edge.createdAt) ?? edge.createdAt,
  }
}

export function applyCanvasEvent(
  state: CanvasStateSlice,
  payload: ApplyEventPayload
): Partial<CanvasStateSlice> {
  const { event, data } = payload

  switch (event) {
    case 'node:created': {
      const node = normalizeNodeDates(data as Node)
      // Evitar duplicados (idempotencia)
      if (state.nodes.some((n) => n.id === node.id)) return {}
      return { nodes: [...state.nodes, node] }
    }

    case 'node:updated': {
      const node = normalizeNodeDates(data as Node)
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
      const edge = normalizeEdgeDates(data as Edge)
      if (state.edges.some((e) => e.id === edge.id)) return {}
      return { edges: [...state.edges, edge] }
    }

    case 'edge:updated': {
      const edge = normalizeEdgeDates(data as Edge)
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