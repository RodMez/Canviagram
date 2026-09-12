'use client'

import type { Node, NodeStatus } from '@/lib/db/schema'
import { isDemoWorkspace } from '@/lib/demo/fixtures'
import { useCanvasStore } from '@/store/canvas-store'

// Único lugar que decide cómo se persiste un cambio de status de una tarea.
// Lo usan TaskNode (canvas) y BoardCard (tablero) — ambas vistas comparten
// la misma regla: demo → mutación local vía applyLocalEvent (cero DB);
// workspace real → PATCH /nodes/[nodeId] (la respuesta la refleja SSE).
export function patchTaskStatus(workspaceId: string, node: Node, status: NodeStatus): void {
  if (isDemoWorkspace(workspaceId)) {
    useCanvasStore.getState().applyLocalEvent({
      event: 'node:updated',
      data: { ...node, status },
    })
    return
  }
  fetch(`/api/workspaces/${workspaceId}/nodes/${node.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  }).catch((err) => console.error('[task-status] status patch failed', err))
}