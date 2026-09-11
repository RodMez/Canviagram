import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/lib/db'
import { users, appSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { env } from '@/lib/env'
import {
  getAiSettings,
  saveAiSettings,
  invalidateAiSettingsCache,
  notifyAdminsOfFallback,
} from '@/lib/ai/settings'
import { assertIsAdmin } from '@/lib/auth/platform-access'

// ============================================================
// F5.5a: settings de IA en runtime + guard de admin
// ============================================================

const adminId = uuidv4()
const userId = uuidv4()

async function cleanup() {
  try {
    await db.delete(users).where(eq(users.id, adminId))
    await db.delete(users).where(eq(users.id, userId))
  } catch {
    // ignore
  }
}

describe('ai-settings (F5.5a)', () => {
  beforeAll(async () => {
    await cleanup()
    invalidateAiSettingsCache()
    await db.insert(users).values([
      { id: adminId, email: `admin-${adminId.slice(0, 8)}@example.com`, passwordHash: 'x', displayName: 'Admin', role: 'admin', createdAt: new Date(), updatedAt: new Date() },
      { id: userId, email: `plain-${userId.slice(0, 8)}@example.com`, passwordHash: 'x', displayName: 'Plain', role: 'user', createdAt: new Date(), updatedAt: new Date() },
    ])
  })

  afterAll(async () => {
    await cleanup()
    invalidateAiSettingsCache()
  })

  it('lazy-seed: tabla vacía → siembra desde env.AI_MODEL', async () => {
    await db.delete(appSettings)
    invalidateAiSettingsCache()
    const settings = await getAiSettings()
    expect(settings.model).toBe(env.AI_MODEL)
    expect(settings.fallback).toEqual([])
    const row = await db.select().from(appSettings).where(eq(appSettings.id, 'default')).get()
    expect(row?.aiModel).toBe(env.AI_MODEL)
  })

  it('saveAiSettings persiste y la siguiente lectura lo ve (invalida cache)', async () => {
    await saveAiSettings('test/model-a', ['test/model-b'])
    invalidateAiSettingsCache()
    const settings = await getAiSettings()
    expect(settings).toEqual({ model: 'test/model-a', fallback: ['test/model-b'] })
    // Restaura para no contaminar otros tests.
    await saveAiSettings(env.AI_MODEL, [])
  })

  it('fallback malformado en DB no rompe (parse defensivo)', async () => {
    await db
      .insert(appSettings)
      .values({ id: 'default', aiModel: 'x', aiModelFallback: 'no-json{{{', updatedAt: new Date() })
      .onConflictDoUpdate({ target: appSettings.id, set: { aiModelFallback: 'no-json{{{' } })
      .run()
    invalidateAiSettingsCache()
    expect((await getAiSettings()).fallback).toEqual([])
    await saveAiSettings(env.AI_MODEL, [])
  })

  it('notifyAdminsOfFallback sin admins vinculados no lanza', async () => {
    // Nadie tiene Telegram vinculado en tests: best-effort, debe resolver.
    await expect(notifyAdminsOfFallback('m1', 'm2')).resolves.toBeUndefined()
    await expect(notifyAdminsOfFallback('m1', undefined)).resolves.toBeUndefined()
  })

  it('assertIsAdmin: admin pasa, user y desconocido lanzan ForbiddenError', async () => {
    await expect(assertIsAdmin(adminId)).resolves.toBeUndefined()
    await expect(assertIsAdmin(userId)).rejects.toThrowError(
      expect.objectContaining({ name: 'ForbiddenError' })
    )
    await expect(assertIsAdmin(uuidv4())).rejects.toThrowError(
      expect.objectContaining({ name: 'ForbiddenError' })
    )
  })
})
