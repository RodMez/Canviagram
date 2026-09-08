import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Hash de token de un solo uso (verificación de email, reset de contraseña,
 * invitaciones). Los tokens son uuidv4 (alta entropía) → sha256 es suficiente
 * (no bcrypt, que sería innecesariamente lento para este caso).
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Comparación en tiempo constante de dos hashes/tokens.
 * Chequea longitud primero para no crashear si difieren.
 */
export function tokensEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}