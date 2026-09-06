import { randomBytes } from 'crypto'
import { LINK_CODE_LENGTH, LINK_CODE_TTL_SECONDS, MAX_CODES, TG_ALPHABET } from '@/lib/telegram/config'

export type LinkClaim = { workspaceId: string; userId: string; expiresAt: number }

export type ConsumeResult =
  | { ok: true; workspaceId: string; userId: string }
  | { ok: false; reason: 'not_found' | 'expired' }

// Map en memoria (precedente lib/sse/pubsub.ts): replicas:1, pérdida en restart = regenerar.
const store = new Map<string, LinkClaim>()

function generateCode(): string {
  const bytes = randomBytes(LINK_CODE_LENGTH)
  let code = ''
  for (let i = 0; i < LINK_CODE_LENGTH; i++) {
    code += TG_ALPHABET[bytes[i]! % TG_ALPHABET.length]
  }
  return code
}

// Sweep lazy: purga entradas expiradas al insertar (diseño F4.2 §1.2).
// Array.from: target es5 sin downlevelIteration (mismo patrón que lib/sse/pubsub.ts).
function sweepExpired(now: number): void {
  for (const [code, claim] of Array.from(store)) {
    if (claim.expiresAt <= now) store.delete(code)
  }
}

/**
 * Crea un código de vinculación single-use con TTL.
 * `options` (ttlSeconds/maxCodes) es solo para tests — el contrato público usa
 * LINK_CODE_TTL_SECONDS y MAX_CODES de config (diseño F4.2 §5.4 + §7.1).
 */
export function createLinkCode(
  input: { workspaceId: string; userId: string },
  options?: { ttlSeconds?: number; maxCodes?: number }
): { code: string; expiresAt: Date } {
  const ttlSeconds = options?.ttlSeconds ?? LINK_CODE_TTL_SECONDS
  const maxCodes = options?.maxCodes ?? MAX_CODES
  const now = Date.now()

  sweepExpired(now)

  if (store.size >= maxCodes) {
    throw new Error('Límite de códigos de vinculación alcanzado')
  }

  // Colisión negligible (32^8 ≈ 1.1e12); aún así regenerar si ya existe.
  let code = generateCode()
  while (store.has(code)) {
    code = generateCode()
  }

  const expiresAt = new Date(now + ttlSeconds * 1000)
  store.set(code, { workspaceId: input.workspaceId, userId: input.userId, expiresAt: expiresAt.getTime() })
  return { code, expiresAt }
}

/**
 * Consume un código (single-use): lo elimina del Map de forma atómica
 * (single-thread JS) y valida expiración.
 */
export function consumeLinkCode(code: string): ConsumeResult {
  const normalized = code.trim().toUpperCase()
  const claim = store.get(normalized)
  if (!claim) return { ok: false, reason: 'not_found' }
  store.delete(normalized)
  if (claim.expiresAt <= Date.now()) return { ok: false, reason: 'expired' }
  return { ok: true, workspaceId: claim.workspaceId, userId: claim.userId }
}

// Solo para tests (patrón idéntico a pubsub.ts).
export function _size(): number {
  return store.size
}

export function _clear(): void {
  store.clear()
}