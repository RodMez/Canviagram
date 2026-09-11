import { db } from '@/lib/db'
import { appSettings, users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { env } from '@/lib/env'
import { sendProactiveTelegramToUsers } from '@/lib/telegram/notify'

// ============================================================
// Ajustes de IA en runtime (F5.5)
//
// `app_settings` (fila única id='default'): modelo activo + fallbacks.
// - Lazy-seed desde env.AI_MODEL en el primer arranque (el deploy no
//   rompe si la tabla aún está vacía).
// - Cache en memoria de 60s para no pegar a SQLite en cada mensaje;
//   el PUT de /api/admin/settings la invalida explícitamente.
// ============================================================

export const APP_SETTINGS_ID = 'default'
const SETTINGS_CACHE_TTL_MS = 60_000

export type AiSettings = { model: string; fallback: string[] }

let cached: { value: AiSettings; expiresAt: number } | null = null

export function invalidateAiSettingsCache(): void {
  cached = null
}

function parseFallback(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((m): m is string => typeof m === 'string' && m.length > 0)
  } catch {
    return []
  }
}

export async function getAiSettings(): Promise<AiSettings> {
  const now = Date.now()
  if (cached && cached.expiresAt > now) return cached.value

  let row = await db.select().from(appSettings).where(eq(appSettings.id, APP_SETTINGS_ID)).get()
  if (!row) {
    const seed = {
      id: APP_SETTINGS_ID,
      aiModel: env.AI_MODEL,
      aiModelFallback: '[]',
      updatedAt: new Date(),
    }
    await db.insert(appSettings).values(seed).onConflictDoNothing().run()
    row = await db.select().from(appSettings).where(eq(appSettings.id, APP_SETTINGS_ID)).get()
  }

  const value: AiSettings = row
    ? { model: row.aiModel, fallback: parseFallback(row.aiModelFallback) }
    : { model: env.AI_MODEL, fallback: [] }
  cached = { value, expiresAt: now + SETTINGS_CACHE_TTL_MS }
  return value
}

export async function saveAiSettings(model: string, fallback: string[]): Promise<AiSettings> {
  const now = new Date()
  await db
    .insert(appSettings)
    .values({ id: APP_SETTINGS_ID, aiModel: model, aiModelFallback: JSON.stringify(fallback), updatedAt: now })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: { aiModel: model, aiModelFallback: JSON.stringify(fallback), updatedAt: now },
    })
    .run()
  invalidateAiSettingsCache()
  return getAiSettings()
}

// Aviso al operador (no bloqueante): un fallback ocurrió.
export async function notifyAdminsOfFallback(failedModel: string, nextModel: string | undefined): Promise<void> {
  try {
    const adminRows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'admin'))
      .all()
    if (adminRows.length === 0) return
    const text = nextModel
      ? `⚠️ El modelo "${failedModel}" falló. Canviagram cayó a "${nextModel}".`
      : `⚠️ El modelo "${failedModel}" falló y NO hay fallback configurado.`
    await sendProactiveTelegramToUsers(adminRows.map((u) => u.id), text)
  } catch (error) {
    console.error('[ai-settings] aviso de fallback falló:', (error as Error)?.message ?? error)
  }
}
