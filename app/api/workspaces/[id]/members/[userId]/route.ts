export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { handleApiError } from '@/lib/api-helpers'
import { updateMemberRole, revokeMember } from '@/lib/workspace-admin'

export async function PATCH(request: Request, { params }: { params: { id: string; userId: string } }) {
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
    const { member } = await updateMemberRole(params.id, session.userId, params.userId, body)
    return NextResponse.json({ member })
  } catch (error) {
    return handleApiError(error)
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string; userId: string } }) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    await revokeMember(params.id, session.userId, params.userId)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return handleApiError(error)
  }
}
