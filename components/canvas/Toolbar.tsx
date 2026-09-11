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
}

export function Toolbar({ workspaceName, workspaceSlug, onCreateNode, onReorder, workspaceId }: ToolbarProps) {
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
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
      {/* Workspace name ▾ dropdown */}
      <div className="relative" ref={wsMenuRef}>
        <button
          type="button"
          onClick={() => setWsMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={wsMenuOpen}
          className="flex items-center gap-1 rounded px-2 py-1 text-sm font-medium hover:bg-muted"
        >
          <span>{workspaceName ?? 'Workspace'}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>
        {wsMenuOpen && (
          <div
            role="menu"
            aria-label="Cambiar de workspace"
            className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border bg-popover p-1 shadow-lg"
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
          className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-muted"
        >
          <Settings className="h-4 w-4" />
        </Link>
      )}

      <div className="flex-1" />

      {/* Botón + → abre CreateNodePopup en centro del viewport (solo si el padre lo provee) */}
      {onCreateNode ? (
        <button
          onClick={onCreateNode}
          aria-label="Crear nodo"
          className="flex h-8 w-8 items-center justify-center rounded bg-primary text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
        </button>
      ) : null}

      {/* Reordenar: compacta el grafo a grilla limpia (fix solapes) */}
      {onReorder ? (
        <button
          onClick={onReorder}
          aria-label="Reordenar canvas"
          title="Reordenar canvas"
          className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-muted"
        >
          <Shuffle className="h-4 w-4" />
        </button>
      ) : null}

      {/* Botón colapsar panel */}
      <button
        onClick={togglePanel}
        aria-label={isPanelCollapsed ? 'Expandir panel' : 'Colapsar panel'}
        className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-muted"
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
