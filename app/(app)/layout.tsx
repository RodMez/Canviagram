import type { ReactNode } from 'react'
import { getSession } from '@/lib/auth/session'
import { getUserProfile } from '@/lib/auth/user-profile'
import { isPlatformAdmin } from '@/lib/auth/platform-access'
import { AppShell } from '@/components/layout/AppShell'

// Shell del área autenticada: header global único (logo, nav
// Hoy|Workspaces, acciones contextuales, menú usuario con logout).
// El perfil y el flag admin se resuelven aquí una sola vez en el
// server — las páginas ya no repiten header ni pill de usuario.
// Sin sesión: render plano para que cada page.tsx redirija a /login.
export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession()
  if (!session) {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        {children}
      </div>
    )
  }

  const [profile, isAdmin] = await Promise.all([
    getUserProfile(session.userId),
    isPlatformAdmin(session.userId),
  ])

  return (
    <AppShell
      userName={profile?.displayName ?? null}
      userEmail={profile?.email ?? null}
      isAdmin={isAdmin}
    >
      {children}
    </AppShell>
  )
}
