export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { notifications, workspaces } from '@/lib/db/schema'
import { and, eq, isNull, inArray } from 'drizzle-orm'

// ============================================================
// Campana in-app (Fase 3)
//
// GET  /api/notifications        → no leídas del usuario (con nombre de workspace)
// PATCH /api/notifications       → { ids: string[] } marca como leídas
//
// Alcance: el usuario autenticado (todas sus notificaciones, sin importar
// el workspace). El lector (campana) filtra por userId y readAt = NULL.
// ============================================================

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const rows = await db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      title: notifications.title,
      body: notifications.body,
      nodeId: notifications.nodeId,
      workspaceId: notifications.workspaceId,
      workspaceName: workspaces.name,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
    })
    .from(notifications)
    .leftJoin(workspaces, eq(workspaces.id, notifications.workspaceId))
    .where(and(eq(notifications.userId, session.userId), isNull(notifications.readAt)))
    .orderBy(notifications.createdAt)
    .all()

  return NextResponse.json({
    notifications: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      body: r.body,
      nodeId: r.nodeId,
      workspaceId: r.workspaceId,
      workspaceName: r.workspaceName ?? '',
      createdAt: r.createdAt?.toISOString() ?? null,
    })),
  })
}

export async function PATCH(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === 'string') : []

  if (ids.length === 0) {
    return NextResponse.json({ error: 'Faltan ids' }, { status: 400 })
  }

  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, session.userId), inArray(notifications.id, ids)))
    .run()

  return NextResponse.json({ updated: updated.changes })
}