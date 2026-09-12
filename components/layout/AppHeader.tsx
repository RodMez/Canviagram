'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { CalendarDays, FolderKanban, LogOut, Settings2 } from 'lucide-react'
import { useHeaderActions } from './header-actions-context'

// ============================================================
// AppHeader: único header del área autenticada.
//
// Idéntico en Hoy, Workspaces, Workspace, Settings y Admin:
// logo → /today, nav Hoy|Workspaces con estado activo, slot de
// acciones contextuales y menú de usuario con logout.
//
// El link de Administración vive SOLO en el menú de usuario y
// SOLO si isAdmin (server). Usuarios normales ni lo ven en el DOM.
// La ruta /admin/* sigue protegida en su page.tsx (403 → /).
// ============================================================

type AppHeaderProps = {
  userName: string | null
  userEmail: string | null
  isAdmin: boolean
}

function navLinkClass(active: boolean): string {
  return `flex items-center gap-1.5 rounded px-2 py-1 text-sm transition-colors ${
    active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted'
  }`
}

function UserMenu({
  userName,
  userEmail,
  isAdmin,
}: {
  userName: string | null
  userEmail: string | null
  isAdmin: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Cerrar en click fuera + Escape.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open ])

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch (err) {
      console.error('[AppHeader] logout failed', err)
    } finally {
      router.push('/login')
    }
  }

  const initial = (userName?.trim() || 'U').charAt(0).toUpperCase()

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Menú de usuario"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-sm font-medium transition-colors hover:bg-muted/70 active:bg-muted/80"
      >
        {initial}
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Menú de usuario"
          className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border bg-popover p-1 shadow-lg"
        >
          <div className="border-b border-border px-3 py-2">
            <p className="truncate text-sm font-medium">{userName ?? 'Usuario'}</p>
            {userEmail ? (
              <p className="truncate text-xs text-muted-foreground">{userEmail}</p>
            ) : null}
          </div>
          <Link
            href="/today"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="mt-1 flex items-center gap-2 rounded px-3 py-2 text-sm hover:bg-muted"
          >
            <CalendarDays className="h-4 w-4" />
            Hoy
          </Link>
          <Link
            href="/workspaces"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="mt-1 flex items-center gap-2 rounded px-3 py-2 text-sm hover:bg-muted"
          >
            <FolderKanban className="h-4 w-4" />
            Workspaces
          </Link>
          {isAdmin ? (
            <Link
              href="/admin/settings"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="mt-1 flex items-center gap-2 rounded px-3 py-2 text-sm hover:bg-muted"
            >
              <Settings2 className="h-4 w-4" />
              Administración
            </Link>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            className="mt-1 flex w-full items-center gap-2 rounded border-t border-border px-3 py-2 text-sm text-destructive hover:bg-muted"
          >
            <LogOut className="h-4 w-4" />
            Cerrar sesión
          </button>
        </div>
      ) : null}
    </div>
  )
}

export function AppHeader({ userName, userEmail, isAdmin }: AppHeaderProps) {
  const pathname = usePathname()
  const actions = useHeaderActions()

  const isToday = pathname === '/today' || pathname?.startsWith('/today/') === true
  const isWorkspaces =
    pathname?.startsWith('/workspaces') === true ||
    pathname?.startsWith('/w/') === true ||
    pathname?.startsWith('/invite') === true

  return (
    <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur safe-top">
      {/* Logo → /today (landing post-login) */}
      <Link href="/today" className="flex min-h-11 min-w-0 items-center gap-2 rounded-md pr-1">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary shadow-sm">
          <FolderKanban className="h-4 w-4 text-primary-foreground" />
        </span>
        <span className="hidden font-display text-xl font-semibold tracking-wide min-[390px]:inline">
          Canviagram
        </span>
      </Link>

      {/* Navegación principal persistente (desktop; en móvil vive en MobileNav) */}
      <nav
        aria-label="Navegación principal"
        className="ml-2 hidden items-center gap-1 sm:flex"
      >
        <Link
          href="/today"
          aria-current={isToday ? 'page' : undefined}
          className={navLinkClass(isToday)}
        >
          <CalendarDays className="h-4 w-4" />
          <span>Hoy</span>
        </Link>
        <Link
          href="/workspaces"
          aria-current={isWorkspaces ? 'page' : undefined}
          className={navLinkClass(isWorkspaces)}
        >
          <FolderKanban className="h-4 w-4" />
          <span>Workspaces</span>
        </Link>
      </nav>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-1 overflow-hidden">
        {actions}
      </div>

      <UserMenu userName={userName} userEmail={userEmail} isAdmin={isAdmin} />
    </header>
  )
}
