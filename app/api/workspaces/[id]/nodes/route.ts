import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { listNodes, createNode, NODE_LIST_SORTS } from '@/lib/canvas-service'
import { db } from '@/lib/db'
import { nodes } from '@/lib/db/schema'
import { count, eq, isNull, and } from 'drizzle-orm'
import { handleApiError, parseQueryInt } from '@/lib/api-helpers'
import { assertWorkspaceAccess } from '@/lib/auth/workspace-access'
import { NODE_PRIORITIES } from '@/lib/db/schema'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const limit = parseQueryInt(searchParams.get('limit'), 50)
    const offset = parseQueryInt(searchParams.get('offset'), 0)
    const assigneeId = searchParams.get('assigneeId') ?? searchParams.get('assignee') ?? undefined
    const priority = searchParams.get('priority') ?? undefined
    const boardColumnId = searchParams.get('boardColumnId') ?? undefined
    const rawSort = searchParams.get('sort') ?? undefined
    const rawDir = searchParams.get('dir') ?? undefined

    if (priority !== undefined && !(NODE_PRIORITIES as readonly string[]).includes(priority)) {
      return NextResponse.json({ error: 'Prioridad no válida' }, { status: 400 })
    }
    const sort = (
      rawSort && (NODE_LIST_SORTS as readonly string[]).includes(rawSort) ? rawSort : 'createdAt'
    ) as (typeof NODE_LIST_SORTS)[number]
    const dir = rawDir === 'desc' ? 'desc' : 'asc'

    await assertWorkspaceAccess(id, session.userId, 'viewer')

    const nodeList = await listNodes(id, session.userId, {
      limit,
      offset,
      assigneeId,
      priority,
      boardColumnId,
      sort,
      dir,
    })

    const filterConditions = [eq(nodes.workspaceId, id), isNull(nodes.deletedAt)]
    if (assigneeId) filterConditions.push(eq(nodes.assigneeId, assigneeId))
    if (priority) filterConditions.push(eq(nodes.priority, priority as never))
    if (boardColumnId) filterConditions.push(eq(nodes.boardColumnId, boardColumnId))
    const [countRow] = await db
      .select({ value: count() })
      .from(nodes)
      .where(and(...filterConditions))

    const totalCount = countRow?.value ?? 0

    return NextResponse.json({
      nodes: nodeList,
      pagination: { limit, offset, count: totalCount, hasMore: nodeList.length === limit },
    })
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
    const node = await createNode(id, session.userId, body)
    return NextResponse.json({ node }, { status: 201 })
  } catch (error) {
    return handleApiError(error)
  }
}
