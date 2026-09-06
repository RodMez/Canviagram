import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { listEdges, createEdge } from '@/lib/canvas-service'
import { db } from '@/lib/db'
import { edges } from '@/lib/db/schema'
import { count, eq } from 'drizzle-orm'
import { handleApiError, parseQueryInt } from '@/lib/api-helpers'
import { assertWorkspaceAccess } from '@/lib/auth/workspace-access'

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const limit = parseQueryInt(searchParams.get('limit'), 50)
    const offset = parseQueryInt(searchParams.get('offset'), 0)

    await assertWorkspaceAccess(params.id, session.userId, 'viewer')

    const edgeList = await listEdges(params.id, session.userId, { limit, offset })

    const [countRow] = await db
      .select({ value: count() })
      .from(edges)
      .where(eq(edges.workspaceId, params.id))

    const totalCount = countRow?.value ?? 0

    return NextResponse.json({
      edges: edgeList,
      pagination: { limit, offset, count: totalCount, hasMore: edgeList.length === limit },
    })
  } catch (error) {
    return handleApiError(error)
  }
}

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
    const edge = await createEdge(params.id, session.userId, body)
    return NextResponse.json({ edge }, { status: 201 })
  } catch (error) {
    return handleApiError(error)
  }
}
