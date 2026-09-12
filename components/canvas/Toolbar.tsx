'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Plus,
  PanelRightClose,
  PanelRightOpen,
  ChevronDown,
  Settings,
  Shuffle,
} from 'lucide-react'
import { useCanvasStore } from '@/store/canvas-store'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { cn } from '@/lib/utils'

// ============================================================
// Lógica pura extraída para testear sin DOM (Diseño 13)
// ============================================================

/** Conmutador del panel contextual: nodo seleccionado → detalle, si no → chat. */
export function resolvePanelMode(selectedNodeId: string | null): 'node' | 'chat' {
  return selectedNodeId ? 'node' : 'chat'
}

export type WorkspaceMenuItem = { id: string; name: string; slug: string }

/** Mapea la respuesta de GET /api/workspaces a items del dropdown. */
export function mapWorkspacesForMenu(
  workspaces: Array<{ id: string; name: string; slug: string }>
): WorkspaceMenuItem[] {
  return workspaces.map((w) => ({ id: w.id, name: w.name, slug: w.slug }))
}

// ============================================================
// Toolbar: barra secundaria del workspace (bajo el AppHeader).
//
// El header global (logo, nav Hoy|Workspaces, usuario, logout)
// vive en components/layout/AppHeader. Aquí solo queda lo
// contextual del canvas: switcher de workspace, crear, reordenar,
// colapsar panel, campana y acceso a configuración.
// ============================================================

type ToolbarProps = {
  workspaceName?: string
  workspaceSlug?: string
  /** Abre CreateNodePopup en el centro del viewport (lo provee el padre). */
  onCreateNode?: () => void
  /** Reordena el grafo a una grilla limpia. */
  onReorder?: () => void
  /** Id del workspace actual (para la campana de notificaciones). */
  workspaceId?: string
  /** Vista activa del workspace (F6.1): Tablero o Canvas. */
  view?: 'board' | 'canvas'
  onChangeView?: (v: 'board' | 'canvas') => void
}

export function Toolbar({
  workspaceName,
  workspaceSlug,
  onCreateNode,
  onReorder,
  workspaceId,
  view,
  onChangeView,
}: ToolbarProps) {
  const isPanelCollapsed = useCanvasStore((s) => s.isPanelCollapsed)
  const togglePanel = useCanvasStore((s) => s.togglePanel)

  const [workspaces, setWorkspaces] = useState<WorkspaceMenuItem[]>([])
  const [wsMenuOpen, setWsMenuOpen] = useState(false)
  const wsMenuRef = useRef<HTMLDivElement>(null)

  // Carga la lista de workspaces del usuario para el dropdown.
  useEffect(() => {
    let cancelled = false
    fetch('/api/workspaces')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('fetch failed'))))
      .then((data: { workspaces: WorkspaceMenuItem[] }) => {
        if (!cancelled) setWorkspaces(mapWorkspacesForMenu(data.workspaces ?? []))
      })
      .catch((err) => console.error('[Toolbar] failed to load workspaces', err))
    return () => {
      cancelled = true
    }
  }, [])

  // Cerrar el switcher en click fuera + Escape.
  useEffect(() => {
    if (!wsMenuOpen) return
    const onPointerDown = (e: MouseEvent) => {
      if (wsMenuRef.current && !wsMenuRef.current.contains(e.target as Node)) setWsMenuOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWsMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [wsMenuOpen])

  return (
    <div className="flex min-h-12 shrink-0 items-center gap-1.5 border-b border-border bg-background px-3 sm:gap-2 sm:px-4">
      {/* Workspace name ▾ dropdown */}
      <div className="relative" ref={wsMenuRef}>
        <button
          type="button"
          onClick={() => setWsMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={wsMenuOpen}
          className="flex min-h-11 min-w-0 items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium hover:bg-muted active:bg-muted/80"
        >
          <span className="max-w-40 truncate sm:max-w-xs">{workspaceName ?? 'Workspace'}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>
        {wsMenuOpen && (
          <div
            role="menu"
            aria-label="Cambiar de workspace"
            className="absolute left-0 top-full z-50 mt-1 w-56 max-w-[calc(100vw-2rem)] rounded-lg border bg-popover p-1 shadow-lg"
          >
            {workspaces.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">Sin workspaces</p>
            )}
            {workspaces.map((w) => (
              <Link
                key={w.id}
                href={`/w/${w.slug}`}
                role="menuitem"
                onClick={() => setWsMenuOpen(false)}
                className="block rounded px-3 py-2 text-sm hover:bg-muted"
              >
                {w.name}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Configuración del workspace actual */}
      {workspaceSlug && (
        <Link
          href={`/w/${workspaceSlug}/settings`}
          aria-label="Configuración del workspace"
          title="Configuración del workspace"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted active:bg-muted/80"
        >
          <Settings className="h-4 w-4" />
        </Link>
      )}

      {/* Switcher de vista (F6.1): Tablero ↔ Canvas, junto al nombre del workspace. */}
      {view && onChangeView ? (
        <div
          role="group"
          aria-label="Vista del workspace"
          className="ml-1 flex items-center gap-0.5 rounded-lg bg-muted p-0.5"
        >
          <button
            type="button"
            onClick={() => onChangeView('board')}
            aria-pressed={view === 'board'}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              view === 'board' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Tablero
          </button>
          <button
            type="button"
            onClick={() => onChangeView('canvas')}
            aria-pressed={view === 'canvas'}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              view === 'canvas' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Canvas
          </button>
        </div>
      ) : null}

      <div className="flex-1" />

      {/* Botón + → abre CreateNodePopup en centro del viewport (solo si el padre lo provee) */}
      {onCreateNode ? (
        <button
          onClick={onCreateNode}
          aria-label="Crear nodo"
          className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90 active:opacity-80"
        >
          <Plus className="h-4 w-4" />
        </button>
      ) : null}

      {/* Reordenar: compacta el grafo a grilla limpia (fix solapes). Solo en Canvas:
          no tiene sentido reordenar columnas de un Tablero (F6.1). */}
      {onReorder && view !== 'board' ? (
        <button
          onClick={onReorder}
          aria-label="Reordenar canvas"
          title="Reordenar canvas"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted active:bg-muted/80"
        >
          <Shuffle className="h-4 w-4" />
        </button>
      ) : null}

      {/* Botón colapsar panel */}
      <button
        onClick={togglePanel}
        aria-label={isPanelCollapsed ? 'Expandir panel' : 'Colapsar panel'}
        className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted active:bg-muted/80"
      >
        {isPanelCollapsed ? (
          <PanelRightOpen className="h-4 w-4" />
        ) : (
          <PanelRightClose className="h-4 w-4" />
        )}
      </button>

      {/* Campana de notificaciones (Fase 3) */}
      {workspaceId ? <NotificationBell workspaceId={workspaceId} /> : null}
    </div>
  )
}
