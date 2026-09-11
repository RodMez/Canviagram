import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { assertIsAdmin } from '@/lib/auth/platform-access'
import { ForbiddenError } from '@/lib/errors'
import { AdminSettingsClient } from './admin-settings-client'

// CRÍTICO: depende de la cookie de sesión en server component → no estático.
export const dynamic = 'force-dynamic'

export default async function AdminSettingsPage() {
  const session = await getSession()
  if (!session) {
    redirect('/login?next=/admin/settings')
  }

  try {
    await assertIsAdmin(session.userId)
  } catch (error) {
    if (error instanceof ForbiddenError) {
      redirect('/')
    }
    throw error
  }

  return <AdminSettingsClient />
}
