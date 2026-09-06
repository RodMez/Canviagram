export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { assertCanAdmin } from '@/lib/auth/workspace-access'
import { isTelegramEnabled, LINK_CODE_TTL_SECONDS } from '@/lib/telegram/config'
import { createLinkCode } from '@/lib/telegram/link-store'
import { deleteBindingsByWorkspace } from '@/lib/telegram/chats'
import { handleApiError } from '@/lib/api-helpers'

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    // Orden del diseño F4.2 §4.2 M1: session → assertCanAdmin → isTelegramEnabled → createLinkCode
    await assertCanAdmin(params.id, session.userId)

    if (!isTelegramEnabled()) {
      return NextResponse.json(
        { error: 'Telegram no está habilitado. Configura TELEGRAM_BOT_TOKEN y TELEGRAM_WEBHOOK_SECRET en .env' },
        { status: 503 }
      )
    }

    const { code, expiresAt } = createLinkCode({ workspaceId: params.id, userId: session.userId })

    return NextResponse.json({
      code,
      expiresAt: expiresAt.toISOString(),
      ttlSeconds: LINK_CODE_TTL_SECONDS,
      workspaceId: params.id,
    })
  } catch (error) {
    return handleApiError(error)
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    await assertCanAdmin(params.id, session.userId)

    if (!isTelegramEnabled()) {
      return NextResponse.json(
        { error: 'Telegram no está habilitado en este despliegue' },
        { status: 503 }
      )
    }

    await deleteBindingsByWorkspace(params.id)

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return handleApiError(error)
  }
}