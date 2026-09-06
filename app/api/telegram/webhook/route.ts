export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { isTelegramEnabled, telegramWebhookSecret, MAX_WEBHOOK_BODY_BYTES } from '@/lib/telegram/config'
import { getBot, isDuplicateUpdate } from '@/lib/telegram/bot'

// Timing-safe compare (diseño F4.2 §5.1).
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

// Webhook público por diseño (middleware.ts no cubre /api/telegram).
// Reglas duras: nunca loguear el body del update; siempre 200 tras auth.
export async function POST(request: Request) {
  // 1. Auth: mismo 401 si el bot está deshabilitado (no filtrar config).
  const secret = telegramWebhookSecret()
  const header = request.headers.get('x-telegram-bot-api-secret-token')
  if (!isTelegramEnabled() || !secret || !header || !safeEqual(header, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Cap body (content-length o lectura real > 512 KB) → ack & drop.
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_WEBHOOK_BODY_BYTES) {
    console.error('[telegram] webhook body excede el cap — ack & drop')
    return NextResponse.json({ ok: true })
  }

  let raw: string
  try {
    raw = await request.text()
  } catch {
    return NextResponse.json({ ok: true })
  }
  // raw.length cuenta UTF-16 code units; el cap es en bytes UTF-8 (diseño F4.2 §5.1).
  if (Buffer.byteLength(raw, 'utf8') > MAX_WEBHOOK_BODY_BYTES) {
    console.error('[telegram] webhook body excede el cap — ack & drop')
    return NextResponse.json({ ok: true })
  }

  // 3. JSON parse → dedupe update_id (ring-buffer en bot.ts).
  let update: { update_id?: number }
  try {
    update = JSON.parse(raw) as { update_id?: number }
  } catch {
    return NextResponse.json({ ok: true })
  }

  if (typeof update.update_id === 'number' && isDuplicateUpdate(update.update_id)) {
    return NextResponse.json({ ok: true })
  }

  // 4. Procesar: siempre 200 tras auth, incluso si handleUpdate lanza.
  // Log solo update_id + mensaje (nunca el body completo).
  try {
    await getBot().handleUpdate(update as never)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown'
    console.error(`[telegram] update ${update.update_id ?? '?'} falló: ${message}`)
  }

  return NextResponse.json({ ok: true })
}