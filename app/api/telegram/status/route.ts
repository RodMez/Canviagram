export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { isTelegramEnabled } from '@/lib/telegram/config'
import { getBot, getBotUsername } from '@/lib/telegram/bot'
import { listBindingsByUser } from '@/lib/telegram/chats'
import { listWorkspacesForUser } from '@/lib/canvas/workspace-by-slug'
import { handleApiError } from '@/lib/api-helpers'

// ============================================================
// GET /api/telegram/status — estado global del vínculo (cuenta).
// Bot + webhook (una sola conexión) + mis chats + mis workspaces
// (lista lista para usar sin revincular).
// ============================================================

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    if (!isTelegramEnabled()) {
      return NextResponse.json({
        enabled: false,
        botUsername: null,
        webhook: null,
        chats: [],
        workspaces: [],
      })
    }

    const bot = getBot()
    const [bindings, allWorkspaces] = await Promise.all([
      listBindingsByUser(session.userId),
      listWorkspacesForUser(session.userId),
    ])

    const chats = bindings.map((c) => ({
      chatId: c.telegramChatId,
      tgUserId: c.telegramUserId,
      activeWorkspaceId: c.activeWorkspaceId,
      lastActivityAt: c.lastActivityAt?.toISOString() ?? null,
    }))

    const workspaces = allWorkspaces.map((w) => ({
      id: w.id,
      name: w.name,
      slug: w.slug,
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
      chats,
      workspaces,
    })
  } catch (error) {
    return handleApiError(error)
  }
}

// ============================================================
// POST /api/telegram/status — "Probar bot" global.
// Envía un mensaje de prueba a TODOS los chats de la cuenta
// (sin filtrar por workspace activo).
// ============================================================

export async function POST() {
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

    const bot = getBot()

    let webhookInfo: Record<string, unknown>
    try {
      webhookInfo = (await bot.api.getWebhookInfo()) as unknown as Record<string, unknown>
    } catch {
      return NextResponse.json(
        { error: 'No se pudo contactar con la API de Telegram' },
        { status: 502 }
      )
    }

    const chats = await listBindingsByUser(session.userId)
    let sentTo = 0
    for (const chat of chats) {
      try {
        await bot.api.sendMessage(chat.telegramChatId, '✅ <b>Canviagram conectado</b>\nRecibes notificaciones en todos tus workspaces. Cambia con /lista y /usar.', {
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
