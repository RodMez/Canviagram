export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { handleApiError } from '@/lib/api-helpers'
import { inviteMember } from '@/lib/workspace-admin'

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  try {
    const { invitation, status } = await inviteMember(params.id, session.userId, body)
    // 201 si se creó nueva invitación; 200 si se reenvió una pendiente (idempotente)
    return NextResponse.json(
      { invitation: { id: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt } },
      { status: status === 'created' ? 201 : 200 }
    )
  } catch (error) {
    return handleApiError(error)
  }
}
