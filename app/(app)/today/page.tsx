import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { getUserProfile } from '@/lib/auth/user-profile'
import { TodayClient } from './today-client'

// CRÍTICO: depende de la cookie de sesión en server component → no estático.
export const dynamic = 'force-dynamic'

export default async function TodayPage() {
  const session = await getSession()
  if (!session) {
    redirect('/login?next=/today')
  }

  const profile = await getUserProfile(session.userId)

  return (
    <TodayClient
      userName={profile?.displayName ?? null}
      userEmail={profile?.email ?? null}
    />
  )
}
