export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { assertWorkspaceAccess } from '@/lib/auth/workspace-access'
import { updateEdge, deleteEdge, ValidationError, NotFoundError, ForbiddenError } from '@/lib/canvas-service'

export async function PATCH(
  request: Request,
  { params }: { params: { id: string; edgeId: string } }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    await assertWorkspaceAccess(params.id, session.userId, 'member')

    const body = await request.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 })
    }

    const updated = await updateEdge(params.id, params.edgeId, session.userId, body)
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message, details: (error as ValidationError).details }, { status: 400 })
    }
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error('PATCH edge error:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; edgeId: string } }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    await assertWorkspaceAccess(params.id, session.userId, 'member')

    const deleted = await deleteEdge(params.id, params.edgeId, session.userId)
    return NextResponse.json(deleted)
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('DELETE edge error:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
