import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ForbiddenError, NotFoundError } from '@/lib/errors'

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/auth/workspace-access', () => ({ assertCanAdmin: vi.fn() }))
vi.mock('@/lib/telegram/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/telegram/config')>()
  return { ...actual, isTelegramEnabled: vi.fn() }
})

import { POST } from '@/app/api/workspaces/[id]/telegram/link/route'
import { getSession } from '@/lib/auth/session'
import { assertCanAdmin } from '@/lib/auth/workspace-access'
import { isTelegramEnabled } from '@/lib/telegram/config'
import { consumeLinkCode, _clear as clearLinkStore } from '@/lib/telegram/link-store'

const mSession = vi.mocked(getSession)
const mAssertCanAdmin = vi.mocked(assertCanAdmin)
const mIsEnabled = vi.mocked(isTelegramEnabled)

const WS_ID = 'ws-link-route'
const USER_ID = 'u-link-route'

function makeRequest(): Request {
  return new Request('http://localhost/api/workspaces/x/telegram/link', { method: 'POST' })
}

describe('POST /api/workspaces/:id/telegram/link', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    clearLinkStore()
  })

  it('401 sin sesión', async () => {
    mSession.mockResolvedValue(null)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: WS_ID }) })
    expect(res.status).toBe(401)
  })

  it('403 si assertCanAdmin lanza ForbiddenError', async () => {
    mSession.mockResolvedValue({ userId: USER_ID, token: 't' })
    mIsEnabled.mockReturnValue(true)
    mAssertCanAdmin.mockRejectedValue(new ForbiddenError('Se requiere rol mínimo: admin'))
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: WS_ID }) })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Se requiere rol mínimo: admin')
  })

  it('404 si el workspace no existe (vía assertCanAdmin)', async () => {
    mSession.mockResolvedValue({ userId: USER_ID, token: 't' })
    mIsEnabled.mockReturnValue(true)
    mAssertCanAdmin.mockRejectedValue(new NotFoundError('Workspace no encontrado'))
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'ws-missing' }) })
    expect(res.status).toBe(404)
  })

  it('503 si Telegram no está habilitado', async () => {
    mSession.mockResolvedValue({ userId: USER_ID, token: 't' })
    mIsEnabled.mockReturnValue(false)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: WS_ID }) })
    expect(res.status).toBe(503)
    expect((await res.json()).error).toContain('Telegram no está habilitado')
  })

  it('200 con contrato {code, expiresAt, ttlSeconds, workspaceId} + round-trip real', async () => {
    mSession.mockResolvedValue({ userId: USER_ID, token: 't' })
    mIsEnabled.mockReturnValue(true)
    mAssertCanAdmin.mockResolvedValue({ role: 'admin', workspace: { id: WS_ID } } as never)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: WS_ID }) })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/)
    expect(typeof body.expiresAt).toBe('string')
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now())
    expect(body.ttlSeconds).toBe(600)
    expect(body.workspaceId).toBe(WS_ID)

    // Round-trip real: el código generado se redime una sola vez con el claim correcto
    const claim = consumeLinkCode(body.code)
    expect(claim).toEqual({ ok: true, workspaceId: WS_ID, userId: USER_ID })
    expect(consumeLinkCode(body.code)).toEqual({ ok: false, reason: 'not_found' })
  })
})