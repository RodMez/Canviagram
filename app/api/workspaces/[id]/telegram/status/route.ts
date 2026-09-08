export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { assertWorkspaceAccess, assertCanAdmin } from '@/lib/auth/workspace-access'
import { isTelegramEnabled } from '@/lib/telegram/config'
import { getBot, getBotUsername } from '@/lib/telegram/bot'
import { listChatsByActiveWorkspace } from '@/lib/telegram/chats'
import { handleApiError } from '@/lib/api-helpers'

// ============================================================
// GET /api/workspaces/:id/telegram/status
// Estado visible del vínculo del bot con este workspace (Fase 1):
// bot habilitado, webhook registrado (ok / último error) y chats activos.
// ============================================================

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const { role } = await assertWorkspaceAccess(id, session.userId, 'viewer')
    const canAdmin = role === 'owner' || role === 'admin'

    if (!isTelegramEnabled()) {
      return NextResponse.json({
        enabled: false,
        botUsername: null,
        webhook: null,
        chats: [],
        canAdmin,
      })
    }

    const bot = getBot()
    const chatRows = await listChatsByActiveWorkspace(id)
    const chats = chatRows.map((c) => ({
      chatId: c.telegramChatId,
      tgUserId: c.telegramUserId,
      lastActivityAt: c.lastActivityAt?.toISOString() ?? null,
    }))

    let webhook: {
      ok: boolean
      url: string
      pendingUpdateCount: number
      lastError: string | null
      lastErrorDate: string | null
    }
    try {
      const info = await bot.api.getWebhookInfo()
      webhook = {
        ok: Boolean(info.url),
        url: info.url ?? '',
        pendingUpdateCount: info.pending_update_count ?? 0,
        lastError: info.last_error_message ?? null,
        lastErrorDate: info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : null,
      }
    } catch {
      webhook = { ok: false, url: '', pendingUpdateCount: 0, lastError: 'no se pudo consultar el webhook', lastErrorDate: null }
    }

    return NextResponse.json({
      enabled: true,
      botUsername: getBotUsername(),
      webhook,
      // El detalle de chats solo lo ve quien administra el workspace.
      chats: canAdmin ? chats : [],
      canAdmin,
    })
  } catch (error) {
    return handleApiError(error)
  }
}

// ============================================================
// POST /api/workspaces/:id/telegram/status — "Probar bot"
// admin+: consulta el webhook y envía un mensaje de prueba a los chats
// cuyo workspace activo es este (verificación real de conectividad).
// ============================================================

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    await assertCanAdmin(id, session.userId)

    if (!isTelegramEnabled()) {
      return NextResponse.json(
        { error: 'Telegram no está habilitado. Configura TELEGRAM_BOT_TOKEN y TELEGRAM_WEBHOOK_SECRET en .env' },
        { status: 503 }
      )
    }

    const bot = getBot()

    let webhookInfo: Record<string, unknown>
    try {
      webhookInfo = (await bot.api.getWebhookInfo()) as unknown as Record<string, unknown>
    } catch (error) {
      return NextResponse.json(
        { error: 'No se pudo contactar con la API de Telegram' },
        { status: 502 }
      )
    }

    const chats = await listChatsByActiveWorkspace(id)
    let sentTo = 0
    for (const chat of chats) {
      try {
        await bot.api.sendMessage(chat.telegramChatId, '✅ <b>Canviagram conectado</b>\nWebhook funcionando: recibes notificaciones de este workspace.', {
          parse_mode: 'HTML',
        })
        sentTo += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown'
        console.error(`[telegram] test message a ${chat.telegramChatId} falló: ${message}`)
      }
    }

    return NextResponse.json({
      ok: true,
      webhook: {
        ok: Boolean((webhookInfo.url as string | undefined) ?? ''),
        url: (webhookInfo.url as string | undefined) ?? '',
        pendingUpdateCount: (webhookInfo.pending_update_count as number | undefined) ?? 0,
        lastError: (webhookInfo.last_error_message as string | null | undefined) ?? null,
      },
      testSentTo: sentTo,
    })
  } catch (error) {
    return handleApiError(error)
  }
}