export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { handleApiError } from '@/lib/api-helpers'
import { acceptInvitation } from '@/lib/workspace-admin'

export async function POST(_request: Request, { params }: { params: { token: string } }) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const { workspace } = await acceptInvitation(params.token, session.userId)
    return NextResponse.json({ workspace })
  } catch (error) {
    return handleApiError(error)
  }
}