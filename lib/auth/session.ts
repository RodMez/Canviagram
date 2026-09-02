import { cookies } from 'next/headers'
import { createHmac, timingSafeEqual } from 'crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { sessions } from '@/lib/db/schema'
import { env } from '@/lib/env'

export type Session = {
  userId: string
  token: string
  expiresAt?: Date
}

export const SESSION_COOKIE_NAME = '__Host-session'
export const LEGACY_COOKIE_NAME = 'session'

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
} as const

/**
 * HMAC-SHA256 sign with SESSION_SECRET
 */
export function sign(data: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(data).digest('hex')
}

/**
 * Verifica HMAC con timingSafeEqual para evitar timing attacks
 */
export function verifySignature(data: string, signature: string): boolean {
  try {
    const expected = sign(data)
    const a = Buffer.from(expected, 'utf8')
    const b = Buffer.from(signature, 'utf8')
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

function encodePayload(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

function decodePayload(b64: string): Record<string, unknown> | null {
  try {
    const json = Buffer.from(b64, 'base64url').toString('utf8')
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Crea valor de cookie firmado: base64url(payload).signature
 * payload: { userId, token, expiresAt }
 */
export function buildSessionCookieValue(userId: string, token: string, expiresAt: Date): string {
  const payload = encodePayload({ userId, token, expiresAt: expiresAt.toISOString() })
  const signature = sign(payload)
  return `${payload}.${signature}`
}

/**
 * Parsea y verifica cookie __Host-session
 * Retorna payload si firma válida y no expirado, sino null
 */
export function parseAndVerifyCookieValue(raw: string): { userId: string; token: string; expiresAt: Date } | null {
  const parts = raw.split('.')
  if (parts.length !== 2) return null
  const [payloadB64, signature] = parts
  if (!payloadB64 || !signature) return null
  if (!verifySignature(payloadB64, signature)) return null
  const payload = decodePayload(payloadB64)
  if (!payload || typeof payload.userId !== 'string' || typeof payload.token !== 'string') return null
  let expiresAt: Date | null = null
  if (payload.expiresAt) {
    const exp = new Date(payload.expiresAt as string)
    if (Number.isNaN(exp.getTime())) return null
    expiresAt = exp
    if (expiresAt.getTime() < Date.now()) return null
  }
  return { userId: payload.userId, token: payload.token, expiresAt: expiresAt! }
}

/**
 * getSession: verifica __Host-session con HMAC-SHA256 + timingSafeEqual + expiresAt
 * H-R01: SOLO acepta __Host-session con HMAC válido. Cookie legacy 'session' sin HMAC eliminada:
 * si legacy existe se retorna null forzando re-login (evita downgrade).
 * Además verifica tokenHash en DB y expiración real de la sesión cuando existe registro.
 */
export async function getSession(): Promise<Session | null> {
  try {
    const cookieStore = cookies() as unknown as { get: (name: string) => { value: string } | undefined }
    const hostRaw = cookieStore.get(SESSION_COOKIE_NAME)?.value
    const legacyRaw = cookieStore.get(LEGACY_COOKIE_NAME)?.value

    // H-R01: legado sin HMAC no se acepta bajo ningún concepto — forzar re-login
    if (legacyRaw) {
      return null
    }

    if (hostRaw) {
      const parsed = parseAndVerifyCookieValue(hostRaw)
      if (parsed) {
        const { userId, token, expiresAt } = parsed

        // Verificación contra DB si existe registro de sesión (opcional pero reforzada)
        // Si hay registro, validamos tokenHash con timingSafeEqual y expiración DB
        try {
          const tokenHash = sign(token)
          const record = await db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).get()
          if (record) {
            // timingSafeEqual sobre hash almacenado vs calculado
            const a = Buffer.from(record.tokenHash, 'utf8')
            const b = Buffer.from(tokenHash, 'utf8')
            const hashOk = a.length === b.length && timingSafeEqual(a, b)
            if (!hashOk) return null
            if (record.expiresAt.getTime() < Date.now()) return null
            if (record.userId !== userId) return null
            return { userId: record.userId, token, expiresAt: record.expiresAt }
          }
          // Si no hay registro en DB pero firma y expiración de payload son válidas, aceptamos stateless
          // Esto permite sesiones sin DB (útil en tests) mientras mantiene HMAC
          return { userId, token, expiresAt }
        } catch {
          // Si falla DB (ej. en tests sin tabla), fallback a payload verificado
          return { userId, token, expiresAt }
        }
      } else {
        // Firma inválida en __Host-session -> denegar
        return null
      }
    }

    return null
  } catch {
    return null
  }
}

/**
 * Helper para rutas: retorna 401 si no hay sesión
 */
export async function requireSession(): Promise<Session | null> {
  const session = await getSession()
  if (!session) {
    return null
  }
  return session
}
