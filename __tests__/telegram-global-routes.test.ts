import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ForbiddenError, NotFoundError } from '@/lib/errors'

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/auth/workspace-access', () => ({ assertWorkspaceAccess: vi.fn() }))
vi.mock('@/lib/telegram/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/telegram/config')>()
  return { ...actual, isTelegramEnabled: vi.fn() }
})
vi.mock('@/lib/telegram/chats', () => ({
  listBindingsByUser: vi.fn(),
  deleteBindingsByUser: vi.fn(),
}))
vi.mock('@/lib/telegram/bot', () => ({
  getBot: vi.fn(),
  getBotUsername: vi.fn(() => 'test_bot'),
}))
vi.mock('@/lib/canvas/workspace-by-slug', () => ({ listWorkspacesForUser: vi.fn() }))

import { POST as postLink, DELETE as deleteLink } from '@/app/api/telegram/link/route'
import { GET as getStatus, POST as postTest } from '@/app/api/telegram/status/route'
import { getSession } from '@/lib/auth/session'
import { assertWorkspaceAccess } from '@/lib/auth/workspace-access'
import { isTelegramEnabled } from '@/lib/telegram/config'
import { listBindingsByUser, deleteBindingsByUser } from '@/lib/telegram/chats'
import { getBot, getBotUsername } from '@/lib/telegram/bot'
import { listWorkspacesForUser } from '@/lib/canvas/workspace-by-slug'
import { consumeLinkCode, _clear as clearLinkStore } from '@/lib/telegram/link-store'

const mSession = vi.mocked(getSession)
const mAssert = vi.mocked(assertWorkspaceAccess)
const mEnabled = vi.mocked(isTelegramEnabled)
const mListBindings = vi.mocked(listBindingsByUser)
const mDeleteByUser = vi.mocked(deleteBindingsByUser)
const mGetBot = vi.mocked(getBot)
const mGetBotUsername = vi.mocked(getBotUsername)
const mListWs = vi.mocked(listWorkspacesForUser)

const USER_ID = 'u-global'
const WS_ID = 'ws-global'

function authed() {
  mSession.mockResolvedValue({ userId: USER_ID, token: 't' })
}

describe('/api/telegram/link global', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    clearLinkStore()
    mEnabled.mockReturnValue(true)
  })

  it('401 sin sesión (POST y DELETE)', async () => {
    mSession.mockResolvedValue(null)
    const post = await postLink(new Request('http://localhost/api/telegram/link', { method: 'POST', body: '{}' }))
    expect(post.status).toBe(401)
    const del = await deleteLink()
    expect(del.status).toBe(401)
  })

  it('503 si Telegram deshabilitado', async () => {
    authed()
    mEnabled.mockReturnValue(false)
    const post = await postLink(new Request('http://localhost/api/telegram/link', { method: 'POST', body: '{}' }))
    expect(post.status).toBe(503)
  })

  it('POST sin workspace crea código global (workspaceId null)', async () => {
    authed()
    const res = await postLink(new Request('http://localhost/api/telegram/link', { method: 'POST', body: '{}' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.workspaceId).toBeNull()
    expect(body.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/)
    expect(consumeLinkCode(body.code)).toEqual({ ok: true, workspaceId: null, userId: USER_ID })
  })

  it('POST con workspaceId valida acceso y lo deja como hint', async () => {
    authed()
    mAssert.mockResolvedValue({ workspace: { id: WS_ID }, role: 'member' } as never)
    const res = await postLink(
      new Request('http://localhost/api/telegram/link', {
        method: 'POST',
        body: JSON.stringify({ workspaceId: WS_ID }),
      })
    )
    expect(res.status).toBe(200)
    expect(mAssert).toHaveBeenCalledWith(WS_ID, USER_ID, 'viewer')
    const body = await res.json()
    expect(body.workspaceId).toBe(WS_ID)
  })

  it('POST con workspace sin acceso propaga 403/404', async () => {
    authed()
    mAssert.mockRejectedValue(new ForbiddenError('sin acceso'))
    const res = await postLink(
      new Request('http://localhost/api/telegram/link', {
        method: 'POST',
        body: JSON.stringify({ workspaceId: WS_ID }),
      })
    )
    expect(res.status).toBe(403)
    mAssert.mockRejectedValue(new NotFoundError('no existe'))
    const res2 = await postLink(
      new Request('http://localhost/api/telegram/link', {
        method: 'POST',
        body: JSON.stringify({ workspaceId: WS_ID }),
      })
    )
    expect(res2.status).toBe(404)
  })

  it('DELETE borra todos los bindings de la cuenta', async () => {
    authed()
    mDeleteByUser.mockResolvedValue(2)
    const res = await deleteLink()
    expect(res.status).toBe(200)
    expect(mDeleteByUser).toHaveBeenCalledWith(USER_ID)
    expect(await res.json()).toEqual({ unlinked: 2 })
  })
})

describe('/api/telegram/status global', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mEnabled.mockReturnValue(true)
    mGetBotUsername.mockReturnValue('test_bot')
  })

  it('401 sin sesión', async () => {
    mSession.mockResolvedValue(null)
    expect((await getStatus()).status).toBe(401)
    expect((await postTest()).status).toBe(401)
  })

  it('GET deshabilitado retorna shape vacío', async () => {
    authed()
    mEnabled.mockReturnValue(false)
    const res = await getStatus()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      enabled: false,
      botUsername: null,
      webhook: null,
      chats: [],
      workspaces: [],
    })
  })

  it('GET habilitado retorna mis chats + workspaces listos', async () => {
    authed()
    mListBindings.mockResolvedValue([
      { telegramChatId: '1', telegramUserId: '9', userId: USER_ID, activeWorkspaceId: WS_ID, lastActivityAt: new Date('2026-01-01T00:00:00Z'), createdAt: new Date() },
    ] as never)
    mListWs.mockResolvedValue([{ id: WS_ID, name: 'Global', slug: 'global' }] as never)
    mGetBot.mockReturnValue({
      api: { getWebhookInfo: async () => ({ url: 'https://x/webhook', pending_update_count: 3 }) },
    } as never)
    const res = await getStatus()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.enabled).toBe(true)
    expect(body.botUsername).toBe('test_bot')
    expect(body.chats).toHaveLength(1)
    expect(body.chats[0].activeWorkspaceId).toBe(WS_ID)
    expect(body.workspaces).toEqual([{ id: WS_ID, name: 'Global', slug: 'global' }])
    expect(body.webhook.ok).toBe(true)
  })

  it('POST test envía a todos mis chats sin filtrar por activo', async () => {
    authed()
    const sendMessage = vi.fn().mockResolvedValue({})
    mGetBot.mockReturnValue({
      api: { getWebhookInfo: async () => ({ url: 'https://x/webhook' }), sendMessage },
    } as never)
    mListBindings.mockResolvedValue([
      { telegramChatId: '1', telegramUserId: '9', userId: USER_ID, activeWorkspaceId: WS_ID },
      { telegramChatId: '2', telegramUserId: '9', userId: USER_ID, activeWorkspaceId: null },
    ] as never)
    const res = await postTest()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.testSentTo).toBe(2)
    expect(sendMessage).toHaveBeenCalledTimes(2)
  })
})
