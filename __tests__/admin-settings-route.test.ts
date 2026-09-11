import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }))

import { v4 as uuidv4 } from 'uuid'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { GET, PUT } from '@/app/api/admin/settings/route'
import { env } from '@/lib/env'
import { invalidateAiSettingsCache, saveAiSettings } from '@/lib/ai/settings'

const mSession = vi.mocked(getSession)

// ============================================================
// F5.5b: GET/PUT /api/admin/settings (solo admin)
// ============================================================

const adminId = uuidv4()
const userId = uuidv4()

function putRequest(body: unknown): Request {
  return new Request('http://localhost/api/admin/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('admin settings route', () => {
  beforeAll(async () => {
    await db.insert(users).values([
      { id: adminId, email: `adm-${adminId.slice(0, 8)}@example.com`, passwordHash: 'x', displayName: 'Adm', role: 'admin', createdAt: new Date(), updatedAt: new Date() },
      { id: userId, email: `usr-${userId.slice(0, 8)}@example.com`, passwordHash: 'x', displayName: 'Usr', role: 'user', createdAt: new Date(), updatedAt: new Date() },
    ])
    invalidateAiSettingsCache()
  })

  afterAll(async () => {
    try {
      await db.delete(users).where(eq(users.id, adminId))
      await db.delete(users).where(eq(users.id, userId))
    } catch {
      // ignore
    }
    await saveAiSettings(env.AI_MODEL, [])
    invalidateAiSettingsCache()
  })

  it('GET sin sesión → 401', async () => {
    mSession.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
  })

  it('GET sin ser admin → 403; siendo admin → 200', async () => {
    mSession.mockResolvedValue({ userId, email: 'u@x.com' } as never)
    const forbidden = await GET()
    expect(forbidden.status).toBe(403)

    mSession.mockResolvedValue({ userId: adminId, email: 'a@x.com' } as never)
    const ok = await GET()
    expect(ok.status).toBe(200)
    const body = (await ok.json()) as { model: string; fallback: string[] }
    expect(typeof body.model).toBe('string')
    expect(Array.isArray(body.fallback)).toBe(true)
  })

  it('PUT valida: fallback con el modelo activo → 400', async () => {
    mSession.mockResolvedValue({ userId: adminId, email: 'a@x.com' } as never)
    const res = await PUT(putRequest({ model: 'm-a', fallback: ['m-a'] }))
    expect(res.status).toBe(400)
  })

  it('PUT sin ser admin → 403; admin guarda y se lee de vuelta', async () => {
    mSession.mockResolvedValue({ userId, email: 'u@x.com' } as never)
    expect((await PUT(putRequest({ model: 'm-x', fallback: [] }))).status).toBe(403)

    mSession.mockResolvedValue({ userId: adminId, email: 'a@x.com' } as never)
    const res = await PUT(putRequest({ model: 'test/admin-model', fallback: ['test/fb-1'] }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ model: 'test/admin-model', fallback: ['test/fb-1'] })

    const reread = await GET()
    expect(await reread.json()).toEqual({ model: 'test/admin-model', fallback: ['test/fb-1'] })
  })
})
