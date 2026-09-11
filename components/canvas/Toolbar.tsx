'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import {
  Plus,
  PanelRightClose,
  PanelRightOpen,
  ChevronDown,
  LogOut,
  Settings,
  FolderKanban,
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
// Toolbar (Diseño 8)
// ============================================================

type ToolbarProps = {
  workspaceName?: string
  userName?: string | null
  userEmail?: string | null
  /** Abre CreateNodePopup en el centro del viewport (lo provee el padre). */
  onCreateNode?: () => void
  /** Reordena el grafo a una grilla limpia. */
  onReorder?: () => void
  /** Id del workspace actual (para la campana de notificaciones). */
  workspaceId?: string
}

export function Toolbar({ workspaceName, userName, userEmail, onCreateNode, onReorder, workspaceId }: ToolbarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const isPanelCollapsed = useCanvasStore((s) => s.isPanelCollapsed)
  const togglePanel = useCanvasStore((s) => s.togglePanel)

  const [workspaces, setWorkspaces] = useState<WorkspaceMenuItem[]>([])
  const [wsMenuOpen, setWsMenuOpen] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)

  // Slug del workspace actual desde la ruta /w/[slug] (para el link de Configuración).
  const currentSlug = pathname?.split('/')[2]

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

  // Cerrar sesión: POST /api/auth/logout → redirect /login.
  const handleLogout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch (err) {
      console.error('[Toolbar] logout failed', err)
    } finally {
      router.push('/login')
    }
  }, [router])

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4">
      {/* Logo → /workspaces */}
      <Link href="/workspaces" className="flex items-center gap-2 text-sm font-semibold">
        <FolderKanban className="h-5 w-5 text-primary" />
        <span>Canviagram</span>
      </Link>

      {/* Workspace name ▾ dropdown */}
      <div className="relative">
        <button
          onClick={() => setWsMenuOpen((o) => !o)}
          className="flex items-center gap-1 rounded px-2 py-1 text-sm font-medium hover:bg-muted"
        >
          <span>{workspaceName ?? 'Workspace'}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>
        {wsMenuOpen && (
          <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border bg-popover p-1 shadow-lg">
            {workspaces.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">Sin workspaces</p>
            )}
            {workspaces.map((w) => (
              <Link
                key={w.id}
                href={`/w/${w.slug}`}
                onClick={() => setWsMenuOpen(false)}
                className="block rounded px-3 py-2 text-sm hover:bg-muted"
              >
                {w.name}
              </Link>
            ))}
          </div>
        )}
      </div>

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

      {/* Menú de usuario: avatar con identidad real + Configuración + Cerrar sesión */}
      <div className="relative">
        <button
          onClick={() => setAvatarOpen((o) => !o)}
          aria-label="Menú de usuario"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium hover:bg-muted/70"
        >
          {(userName ?? 'U').charAt(0).toUpperCase()}
        </button>
        {avatarOpen && (
          <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border bg-popover p-1 shadow-lg">
            <div className="border-b border-border px-3 py-2">
              <p className="truncate text-sm font-medium">{userName ?? 'Usuario'}</p>
              {userEmail ? (
                <p className="truncate text-xs text-muted-foreground">{userEmail}</p>
              ) : null}
            </div>
            {currentSlug && (
              <Link
                href={`/w/${currentSlug}/settings`}
                onClick={() => setAvatarOpen(false)}
                className="mt-1 flex items-center gap-2 rounded px-3 py-2 text-sm hover:bg-muted"
              >
                <Settings className="h-4 w-4" />
                Configuración
              </Link>
            )}
            <button
              onClick={handleLogout}
              className="mt-1 flex w-full items-center gap-2 rounded border-t border-border px-3 py-2 text-sm text-destructive hover:bg-muted"
            >
              <LogOut className="h-4 w-4" />
              Cerrar sesión
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
