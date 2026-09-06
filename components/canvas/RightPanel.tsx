'use client'

import { useCanvasStore } from '@/store/canvas-store'
import { AiChatPanel, type SseStatus } from './AiChatPanel'
import { NodeDetailPanel } from './NodeDetailPanel'
import { resolvePanelMode } from './Toolbar'

type RightPanelProps = {
  workspaceId: string
  userId: string
  /** Estado de la conexión SSE (B1) para el pill del chat. */
  sseStatus?: SseStatus
}

// Panel contextual derecho (Diseño 12.1): colapsable vía store y conmutador
// AI Chat ↔ Node Detail según haya un nodo seleccionado.
export function RightPanel({ workspaceId, userId, sseStatus = 'connected' }: RightPanelProps) {
  const isPanelCollapsed = useCanvasStore((s) => s.isPanelCollapsed)
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId)

  // Colapsado → no renderiza (el toggle vive en el Toolbar, F3.4d).
  if (isPanelCollapsed) return null

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-background">
      {resolvePanelMode(selectedNodeId) === 'node' ? (
        <NodeDetailPanel workspaceId={workspaceId} userId={userId} />
      ) : (
        <AiChatPanel workspaceId={workspaceId} sseStatus={sseStatus} />
      )}
    </aside>
  )
}
