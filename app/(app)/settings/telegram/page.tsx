import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { TelegramAccountClient } from './telegram-account-client'

// CRITICO: depende de la cookie de sesion en server component -> no estatico.
export const dynamic = 'force-dynamic'

export default async function TelegramSettingsPage() {
  const session = await getSession()
  if (!session) {
    redirect('/login?next=/settings/telegram')
  }

  return <TelegramAccountClient />
}
