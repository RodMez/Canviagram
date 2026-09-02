export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { updateNode, softDeleteNode, ValidationError, NotFoundError, ForbiddenError } from '@/lib/canvas-service'

export async function PATCH(
  request: Request,
  { params }: { params: { id: string; nodeId: string } }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 })
    }

    const updated = await updateNode(params.id, params.nodeId, session.userId, body)
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
    console.error('PATCH node error:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; nodeId: string } }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const deleted = await softDeleteNode(params.id, params.nodeId, session.userId)
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
    console.error('DELETE node error:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
