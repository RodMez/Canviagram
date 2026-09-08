export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { assertWorkspaceAccess } from '@/lib/auth/workspace-access'
import { db } from '@/lib/db'
import { webPushSubscriptions } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { handleApiError } from '@/lib/api-helpers'

// ============================================================
// Suscripción Web Push por usuario + workspace (Fase 3)
//
// POST   /api/workspaces/:id/push/subscription → registra una suscripción
// DELETE /api/workspaces/:id/push/subscription → { endpoint } la elimina
//
// Una suscripción pertenece a userId + workspaceId (el push llega a todos
// los miembros, sin importar el workspace activo en Telegram).
// ============================================================

type SubscriptionBody = {
  endpoint: string
  keys?: { auth?: string; p256dh?: string } | null
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  try {
    await assertWorkspaceAccess(id, session.userId, 'viewer')

    const body = (await request.json().catch(() => null)) as SubscriptionBody | null
    const endpoint = body?.endpoint?.trim()
    if (!endpoint) {
      return NextResponse.json({ error: 'Falta endpoint' }, { status: 400 })
    }

    const existing = await db
      .select({ id: webPushSubscriptions.id })
      .from(webPushSubscriptions)
      .where(eq(webPushSubscriptions.endpoint, endpoint))
      .get()
    if (existing) {
      // Idempotente: re-apunta la suscripción al user+workspace actual.
      await db
        .update(webPushSubscriptions)
        .set({ userId: session.userId, workspaceId: id })
        .where(eq(webPushSubscriptions.id, existing.id))
        .run()
      return NextResponse.json({ ok: true, created: false })
    }

    const auth = body?.keys?.auth ?? ''
    const p256dh = body?.keys?.p256dh ?? ''
    if (!auth || !p256dh) {
      return NextResponse.json({ error: 'Faltan claves de suscripción' }, { status: 400 })
    }

    await db.insert(webPushSubscriptions).values({
      id: uuidv4(),
      userId: session.userId,
      workspaceId: id,
      endpoint,
      keysAuth: auth,
      keysP256dh: p256dh,
    }).run()

    return NextResponse.json({ ok: true, created: true })
  } catch (error) {
    return handleApiError(error)
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  try {
    await assertWorkspaceAccess(id, session.userId, 'viewer')

    const body = (await request.json().catch(() => null)) as SubscriptionBody | null
    const endpoint = body?.endpoint?.trim()
    if (!endpoint) {
      return NextResponse.json({ error: 'Falta endpoint' }, { status: 400 })
    }

    await db
      .delete(webPushSubscriptions)
      .where(and(eq(webPushSubscriptions.endpoint, endpoint), eq(webPushSubscriptions.userId, session.userId)))
      .run()

    return NextResponse.json({ ok: true })
  } catch (error) {
    return handleApiError(error)
  }
}