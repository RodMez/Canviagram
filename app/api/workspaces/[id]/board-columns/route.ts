export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { listBoardColumns, createBoardColumn } from '@/lib/board-service'
import { handleApiError } from '@/lib/api-helpers'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  try {
    const columns = await listBoardColumns(id, session.userId)
    return NextResponse.json({ columns })
  } catch (error) {
    return handleApiError(error)
  }
}

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
    const column = await createBoardColumn(id, session.userId, body)
    return NextResponse.json({ column }, { status: 201 })
  } catch (error) {
    return handleApiError(error)
  }
}
