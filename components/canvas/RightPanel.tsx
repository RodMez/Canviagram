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
  const togglePanel = useCanvasStore((s) => s.togglePanel)
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId)

  // Colapsado → no renderiza (el toggle vive en el Toolbar, F3.4d).
  if (isPanelCollapsed) return null

  return (
    <aside className="fixed inset-x-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-40 flex max-h-[64dvh] min-h-[280px] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl sm:static sm:z-auto sm:h-full sm:max-h-none sm:min-h-0 sm:w-80 sm:shrink-0 sm:rounded-none sm:border-0 sm:border-l sm:shadow-none">
      <div className="flex items-center justify-between border-b border-border px-4 py-2 sm:hidden">
        <span className="mx-auto h-1.5 w-10 -translate-x-1/2 rounded-full bg-muted-foreground/30" aria-hidden />
        <button
          type="button"
          onClick={togglePanel}
          aria-label="Cerrar panel"
          className="absolute right-2 top-1.5 flex h-11 items-center rounded-md px-3 text-xs font-semibold text-muted-foreground active:bg-muted"
        >
          Cerrar
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {resolvePanelMode(selectedNodeId) === 'node' ? (
          <NodeDetailPanel workspaceId={workspaceId} userId={userId} />
        ) : (
          <AiChatPanel workspaceId={workspaceId} sseStatus={sseStatus} />
        )}
      </div>
    </aside>
  )
}
