import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { TodayClient } from './today-client'

// CRÍTICO: depende de la cookie de sesión en server component → no estático.
export const dynamic = 'force-dynamic'

export default async function TodayPage() {
  const session = await getSession()
  if (!session) {
    redirect('/login?next=/today')
  }

  // El perfil de usuario lo resuelve el layout global (AppShell) una sola vez.
  return <TodayClient />
}
