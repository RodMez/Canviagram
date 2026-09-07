export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { handleApiError } from '@/lib/api-helpers'
import { listMembersMeta } from '@/lib/workspace-admin'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const { members, invitations } = await listMembersMeta(id, session.userId)
    return NextResponse.json({ members, invitations })
  } catch (error) {
    return handleApiError(error)
  }
}
