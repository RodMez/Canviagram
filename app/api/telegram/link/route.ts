export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { assertWorkspaceAccess } from '@/lib/auth/workspace-access'
import { isTelegramEnabled, LINK_CODE_TTL_SECONDS } from '@/lib/telegram/config'
import { createLinkCode } from '@/lib/telegram/link-store'
import { deleteBindingsByUser } from '@/lib/telegram/chats'
import { handleApiError } from '@/lib/api-helpers'

// ============================================================
// POST /api/telegram/link — código global de vinculación (cuenta).
// Una sola vinculación vale para todos los workspaces.
// Body opcional { workspaceId?: string } como workspace activo inicial.
// Permiso: cualquier sesión (no exige admin).
// ============================================================

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    if (!isTelegramEnabled()) {
      return NextResponse.json(
        { error: 'Telegram no está habilitado. Configura TELEGRAM_BOT_TOKEN y TELEGRAM_WEBHOOK_SECRET en .env' },
        { status: 503 }
      )
    }

    let workspaceId: string | null = null
    try {
      const body = (await request.json()) as { workspaceId?: unknown }
      if (typeof body?.workspaceId === 'string' && body.workspaceId.trim()) {
        workspaceId = body.workspaceId.trim()
      }
    } catch {
      // Sin body o JSON inválido: vínculo global sin activo inicial.
    }

    if (workspaceId) {
      await assertWorkspaceAccess(workspaceId, session.userId, 'viewer')
    }

    const { code, expiresAt } = createLinkCode({ workspaceId, userId: session.userId })

    return NextResponse.json({
      code,
      expiresAt: expiresAt.toISOString(),
      ttlSeconds: LINK_CODE_TTL_SECONDS,
      workspaceId,
    })
  } catch (error) {
    return handleApiError(error)
  }
}

// ============================================================
// DELETE /api/telegram/link — desvinculación global (cuenta).
// Borra TODOS los bindings de la sesión (todos sus chats).
// ============================================================

export async function DELETE() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    if (!isTelegramEnabled()) {
      return NextResponse.json(
        { error: 'Telegram no está habilitado en este despliegue' },
        { status: 503 }
      )
    }

    const unlinked = await deleteBindingsByUser(session.userId)

    return NextResponse.json({ unlinked })
  } catch (error) {
    return handleApiError(error)
  }
}
