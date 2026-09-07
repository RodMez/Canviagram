import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import InviteClient from '@/components/invite/InviteClient'

// CRÍTICO: depende de la cookie de sesión en server component → no estático.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const session = await getSession()
  if (!session) {
    redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`)
  }

  return <InviteClient token={token} />
}