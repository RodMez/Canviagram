'use client'

import type { ReactNode } from 'react'
import { HeaderActionsProvider } from './header-actions-context'
import { AppHeader } from './AppHeader'
import { MobileNav } from './MobileNav'

// ============================================================
// AppShell: layout client del área autenticada.
//
// Header global idéntico en todas las páginas + contenido.
// El perfil y el flag admin los resuelve el layout server una
// sola vez (sin fetch duplicado por página).
// ============================================================

type AppShellProps = {
  userName: string | null
  userEmail: string | null
  isAdmin: boolean
  children: ReactNode
}

export function AppShell({ userName, userEmail, isAdmin, children }: AppShellProps) {
  return (
    <HeaderActionsProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        <AppHeader userName={userName} userEmail={userEmail} isAdmin={isAdmin} />
        <div className="flex min-h-0 flex-1 flex-col safe-bottom-nav sm:pb-0">{children}</div>
        <MobileNav />
      </div>
    </HeaderActionsProvider>
  )
}
