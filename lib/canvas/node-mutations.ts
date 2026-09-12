'use client'

import type { Node } from '@/lib/db/schema'
import { isDemoWorkspace } from '@/lib/demo/fixtures'
import { useCanvasStore } from '@/store/canvas-store'

// ============================================================
// Mutaciones de nodo/edge desde el cliente (Tablero, Tabla, Canvas)
//
// Misma regla que patchTaskStatus: demo → mutación local vía
// applyLocalEvent (cero DB); workspace real → fetch + dependencia
// del SSE para reflejar. Borrar hace optimismo local SIEMPRE (la
// reducción del evento es idempotente por filtro) para que la UI
// no "rebote" esperando al SSE — era el bug "se mueve pero no se
// elimina".
// ============================================================

export function deleteNodeFromWorkspace(workspaceId: string, nodeId: string): Promise<void> {
  const store = useCanvasStore.getState()
  // Optimismo local + cascade de edges en el store (mismo reducer que SSE).
  store.applyLocalEvent({ event: 'node:deleted', data: { id: nodeId, workspaceId } })
  if (isDemoWorkspace(workspaceId)) {
    return Promise.resolve()
  }
  return fetch(`/api/workspaces/${workspaceId}/nodes/${nodeId}`, { method: 'DELETE' }).then(
    (res) => {
      if (!res.ok) throw new Error('Error al eliminar')
    }
  )
}

export function deleteEdgeFromWorkspace(workspaceId: string, edgeId: string): Promise<void> {
  const store = useCanvasStore.getState()
  store.applyLocalEvent({ event: 'edge:deleted', data: { id: edgeId, workspaceId } })
  if (isDemoWorkspace(workspaceId)) {
    return Promise.resolve()
  }
  return fetch(`/api/workspaces/${workspaceId}/edges/${edgeId}`, { method: 'DELETE' }).then(
    (res) => {
      if (!res.ok) throw new Error('Error al eliminar conexión')
    }
  )
}

/** PATCH genérico de campos de un nodo (edición inline de tabla, detalle, etc.). */
export function patchNode(
  workspaceId: string,
  node: Node,
  updates: Record<string, unknown>
): void {
  if (isDemoWorkspace(workspaceId)) {
    useCanvasStore.getState().applyLocalEvent({
      event: 'node:updated',
      data: { ...node, ...updates },
    })
    return
  }
  fetch(`/api/workspaces/${workspaceId}/nodes/${node.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  }).catch((err) => console.error('[patchNode] failed', err))
}

export type WorkspaceMemberOption = {
  userId: string
  displayName: string
}

/**
 * Carga una sola vez los miembros del workspace para selects/avatars.
 * En demo devuelve un set estable (los "person" de la escena) para
 * poder asignar responsabilidades sin red.
 */
export async function fetchWorkspaceMembers(
  workspaceId: string
): Promise<WorkspaceMemberOption[]> {
  if (isDemoWorkspace(workspaceId)) {
    return []
  }
  const res = await fetch(`/api/workspaces/${workspaceId}/members`)
  if (!res.ok) return []
  const data = (await res.json()) as {
    members?: Array<{ userId: string; displayName: string }>
  }
  return (data.members ?? []).map((m) => ({ userId: m.userId, displayName: m.displayName }))
}