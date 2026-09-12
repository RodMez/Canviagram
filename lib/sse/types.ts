import type { Node, Edge, BoardColumn } from '@/lib/db/schema'

// ============================================================
// Eventos SSE publicados por canvas-service
// Fuente única de verdad: lib/sse/pubsub.ts + canvas-service.ts
// ============================================================

export type SSEEventName =
  | 'node:created'
  | 'node:updated'
  | 'node:deleted'
  | 'edge:created'
  | 'edge:updated'
  | 'edge:deleted'
  | 'column:created'
  | 'column:updated'
  | 'column:deleted'

// Shape del data según cada evento (lo que publish emite)
export type SSEEventData =
  | { event: 'node:created'; data: Node }
  | { event: 'node:updated'; data: Node }
  | { event: 'node:deleted'; data: { id: string; workspaceId: string } }
  | { event: 'edge:created'; data: Edge }
  | { event: 'edge:updated'; data: Edge }
  | { event: 'edge:deleted'; data: { id: string; workspaceId: string } }
  | { event: 'column:created'; data: BoardColumn }
  | { event: 'column:updated'; data: BoardColumn }
  | { event: 'column:deleted'; data: { id: string; workspaceId: string } }

export type SSEMessage = {
  event: SSEEventName
  data: unknown // Lo que llega del EventSource, parseado de JSON
}

// Para el store: tipo genérico de applyEvent
export type ApplyEventPayload = {
  event: SSEEventName
  data: unknown
}