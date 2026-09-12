import { env } from '@/lib/env'

// TTL de códigos de vinculación en segundos (default 10 min).
// Centralizado vía env.LINK_CODE_TTL_SECONDS (lib/env.ts); clamp local como doble defensa.
export const LINK_CODE_TTL_SECONDS =
  Number.isFinite(env.LINK_CODE_TTL_SECONDS) && env.LINK_CODE_TTL_SECONDS > 0
    ? env.LINK_CODE_TTL_SECONDS
    : 600

// Cap de códigos vivos en el Map en memoria (diseño F4.2 §1.2).
export const MAX_CODES = 10_000

// Cap del body del webhook: 512 KB (diseño F4.2 §5.1).
export const MAX_WEBHOOK_BODY_BYTES = 512 * 1024

// Alfabeto sin ambigüedad (sin 0/O/1/I): 32 símbolos → ~40 bits de entropía en 8 chars.
export const TG_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

// Longitud de los códigos de vinculación (8 chars → 32^8 ≈ 1.1e12 combinaciones).
export const LINK_CODE_LENGTH = 8

export function telegramBotToken(): string | undefined {
  return env.TELEGRAM_BOT_TOKEN
}

export function telegramWebhookSecret(): string | undefined {
  return env.TELEGRAM_WEBHOOK_SECRET
}

/**
 * Guard: el bot solo está habilitado si existen AMBOS token y secret.
 * Sin credenciales → 503 claro en /link y 401 en el webhook (sin filtrar config).
 */
export function isTelegramEnabled(): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET)
}