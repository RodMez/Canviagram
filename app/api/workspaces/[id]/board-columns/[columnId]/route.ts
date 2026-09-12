export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { updateBoardColumn, deleteBoardColumn } from '@/lib/board-service'
import { handleApiError } from '@/lib/api-helpers'
import { assertWorkspaceAccess } from '@/lib/auth/workspace-access'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; columnId: string }> }
) {
  const { id, columnId } = await params
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  try {
    await assertWorkspaceAccess(id, session.userId, 'member')
    const body = await request.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 })
    }
    const column = await updateBoardColumn(id, columnId, session.userId, body)
    return NextResponse.json(column)
  } catch (error) {
    return handleApiError(error)
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; columnId: string }> }
) {
  const { id, columnId } = await params
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  try {
    await assertWorkspaceAccess(id, session.userId, 'member')
    let body: unknown = undefined
    try {
      const text = await request.text()
      body = text ? (JSON.parse(text) as unknown) : undefined
    } catch {
      body = undefined
    }
    const result = await deleteBoardColumn(id, columnId, session.userId, body)
    return NextResponse.json(result)
  } catch (error) {
    return handleApiError(error)
  }
}
