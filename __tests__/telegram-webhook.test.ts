import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock parcial de bot.ts: getBot mockeado, isDuplicateUpdate/_resetDedupe reales.
vi.mock('@/lib/telegram/bot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/telegram/bot')>()
  return { ...actual, getBot: vi.fn() }
})
// Mock parcial de config: isTelegramEnabled/telegramWebhookSecret mockeados,
// MAX_WEBHOOK_BODY_BYTES real.
vi.mock('@/lib/telegram/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/telegram/config')>()
  return { ...actual, isTelegramEnabled: vi.fn(), telegramWebhookSecret: vi.fn() }
})

import { POST } from '@/app/api/telegram/webhook/route'
import { getBot, _resetDedupe } from '@/lib/telegram/bot'
import { isTelegramEnabled, telegramWebhookSecret, MAX_WEBHOOK_BODY_BYTES } from '@/lib/telegram/config'
import { makeUpdate } from '@/__tests__/helpers/telegram'

const mGetBot = vi.mocked(getBot)
const mIsEnabled = vi.mocked(isTelegramEnabled)
const mSecret = vi.mocked(telegramWebhookSecret)

const SECRET = 'webhook-secret'

function makeRequest(body?: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    ...(body !== undefined ? { body } : {}),
  })
}

describe('POST /api/telegram/webhook', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    _resetDedupe()
    mIsEnabled.mockReturnValue(true)
    mSecret.mockReturnValue(SECRET)
    mGetBot.mockReturnValue({ handleUpdate: vi.fn() } as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sin header → 401', async () => {
    const res = await POST(makeRequest(JSON.stringify(makeUpdate())))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  it('header incorrecto → 401', async () => {
    const res = await POST(makeRequest(JSON.stringify(makeUpdate()), { 'x-telegram-bot-api-secret-token': 'wrong' }))
    expect(res.status).toBe(401)
  })

  it('bot deshabilitado → 401 (mismo status, no filtra config)', async () => {
    mIsEnabled.mockReturnValue(false)
    const res = await POST(makeRequest(JSON.stringify(makeUpdate()), { 'x-telegram-bot-api-secret-token': SECRET }))
    expect(res.status).toBe(401)
  })

  it('secret correcto + update válido → 200 {ok:true} y handleUpdate con el update parseado', async () => {
    const update = makeUpdate({ text: '/start', updateId: 42 })
    const handleUpdate = vi.fn().mockResolvedValue(undefined)
    mGetBot.mockReturnValue({ handleUpdate } as never)

    const res = await POST(makeRequest(JSON.stringify(update), { 'x-telegram-bot-api-secret-token': SECRET }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(handleUpdate).toHaveBeenCalledTimes(1)
    expect(handleUpdate.mock.calls[0]![0]).toMatchObject({ update_id: 42 })
  })

  it('handleUpdate lanza → 200 (ack) y error logueado sin body', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const handleUpdate = vi.fn().mockRejectedValue(new Error('boom'))
    mGetBot.mockReturnValue({ handleUpdate } as never)

    const res = await POST(makeRequest(JSON.stringify(makeUpdate({ updateId: 7 })), { 'x-telegram-bot-api-secret-token': SECRET }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('update 7 falló: boom'))
    expect(errorSpy.mock.calls[0]![0]).not.toContain('"message"')
    errorSpy.mockRestore()
  })

  it('content-length > cap → 200 sin llamar handleUpdate', async () => {
    const handleUpdate = vi.fn()
    mGetBot.mockReturnValue({ handleUpdate } as never)

    const res = await POST(
      makeRequest(undefined, { 'x-telegram-bot-api-secret-token': SECRET, 'content-length': '999999' })
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(handleUpdate).not.toHaveBeenCalled()
  })

  it('body no-JSON → 200 sin llamar handleUpdate', async () => {
    const handleUpdate = vi.fn()
    mGetBot.mockReturnValue({ handleUpdate } as never)

    const res = await POST(makeRequest('not-json', { 'x-telegram-bot-api-secret-token': SECRET }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(handleUpdate).not.toHaveBeenCalled()
  })

  it('body multi-byte que excede el cap en bytes UTF-8 (no en chars) → 200 ack & drop sin handleUpdate', async () => {
    const handleUpdate = vi.fn()
    mGetBot.mockReturnValue({ handleUpdate } as never)

    // '界' = 3 bytes UTF-8, 1 code unit UTF-16 → 200k chars ≈ 600 KB bytes, ~200 KB chars.
    const body = JSON.stringify(makeUpdate({ text: '界'.repeat(200_000) }))
    expect(Buffer.byteLength(body, 'utf8')).toBeGreaterThan(MAX_WEBHOOK_BODY_BYTES)
    expect(body.length).toBeLessThanOrEqual(MAX_WEBHOOK_BODY_BYTES)

    const res = await POST(makeRequest(body, { 'x-telegram-bot-api-secret-token': SECRET }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(handleUpdate).not.toHaveBeenCalled()
  })

  it('update_id repetido → handleUpdate llamado una sola vez', async () => {
    const handleUpdate = vi.fn().mockResolvedValue(undefined)
    mGetBot.mockReturnValue({ handleUpdate } as never)
    const headers = { 'x-telegram-bot-api-secret-token': SECRET }

    const first = await POST(makeRequest(JSON.stringify(makeUpdate({ updateId: 99 })), headers))
    expect(first.status).toBe(200)
    const second = await POST(makeRequest(JSON.stringify(makeUpdate({ updateId: 99 })), headers))
    expect(second.status).toBe(200)

    expect(handleUpdate).toHaveBeenCalledTimes(1)
  })
})