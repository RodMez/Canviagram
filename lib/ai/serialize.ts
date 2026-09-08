import type { Node, Edge } from '@/lib/db/schema'

// ============================================================
// Serialización pura Node/Edge → payload de chat (F4.1a)
//
// Extraída de lib/ai/tools.ts para que lib/demo/fixtures.ts
// (usado en el CLIENTE por DemoLanding/AiChatPanel) no arrastre
// canvas-service → db → better-sqlite3 al bundle del browser.
// tools.ts re-exporta desde aquí: cero cambio de API.
// ============================================================

export function serializeNode(node: any) {
  return {
    id: node.id,
    type: node.type,
    title: node.title,
    content: node.content,
    status: node.status,
    positionX: node.positionX,
    positionY: node.positionY,
    dueDate: node.dueDate ? new Date(node.dueDate).toISOString() : null,
    reminderOffsetMin: node.reminderOffsetMin ?? null,
  }
}

export function serializeEdge(edge: any) {
  return {
    id: edge.id,
    sourceId: edge.sourceId,
    targetId: edge.targetId,
    type: edge.type,
    label: edge.label,
  }
}