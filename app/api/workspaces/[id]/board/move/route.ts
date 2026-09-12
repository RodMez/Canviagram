export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { moveBoardTask } from '@/lib/board-service'
import { handleApiError } from '@/lib/api-helpers'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
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
    const node = await moveBoardTask(id, session.userId, body)
    return NextResponse.json({ node })
  } catch (error) {
    return handleApiError(error)
  }
}
