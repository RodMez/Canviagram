import fs from 'fs'
import path from 'path'
import { z } from 'zod'

const envSchema = z
  .object({
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    DATABASE_URL: z.string().optional().default('canviagram.db'),
    NODE_ENV: z.enum(['development', 'test', 'production']).optional().default('development'),
    AI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    AI_BASE_URL: z.string().url().optional().default('https://openrouter.ai/api/v1'),
    AI_MODEL: z.string().min(1).optional().default('openrouter/free'),
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
    TELEGRAM_WEBHOOK_URL: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.string().url().optional(),
    ),
    LINK_CODE_TTL_SECONDS: z.coerce.number().int().positive().catch(600).default(600),
    BREVO_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().email().optional(),
    BREVO_SENDER_EMAIL: z.string().email().optional(),
    NEXT_PUBLIC_APP_URL: z.string().url().optional(),
    // Fase 3: notificaciones push + sweeper de recordatorios
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().optional(),
    REMINDER_SWEEP_SECRET: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === 'production' && data.DATABASE_URL) {
      // Permitir build local con DATABASE_URL relativo (ej. canviagram.db) cuando se ejecuta `next build`.
      // En runtime de producción (Docker) DATABASE_URL debe ser absoluto (/data/...) y esa validación sí aplica.
      const isBuildPhase =
        process.env.NEXT_PHASE === 'phase-production-build' ||
        process.env.npm_lifecycle_event === 'build' ||
        process.argv.some((a) => a.includes('next') && a.includes('build'))
      if (isBuildPhase) return
      let p = data.DATABASE_URL
      if (p.startsWith('file:')) p = p.slice(5)
      p = p.split('?')[0]!
      // Usar chequeo POSIX explícito para evitar discrepancias win32 vs posix
      // (path.isAbsolute en Windows no reconoce /data/... como absoluto,
      //  y el bundle puede usar win32 aunque corra en Linux).
      const isAbsolutePosix = p.startsWith('/') || p.startsWith('C:/') || p.startsWith('C:\\') || path.isAbsolute(p)
      if (p && !isAbsolutePosix) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DATABASE_URL'],
          message:
            'DATABASE_URL must be an absolute path in production (e.g. /data/canviagram.db or file:/data/canviagram.db)',
        })
      }
    }
  })

function parseEnv() {
  // Intentar cargar .env.local manualmente si SESSION_SECRET no está en process.env
  // (vitest no carga automáticamente .env.local)
  if (!process.env.SESSION_SECRET) {
    try {
      const envPath = path.resolve(process.cwd(), '.env.local')
      if (fs.existsSync(envPath)) {
        const content: string = fs.readFileSync(envPath, 'utf8')
        for (const line of content.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith('#')) continue
          const eqIdx = trimmed.indexOf('=')
          if (eqIdx === -1) continue
          const k = trimmed.slice(0, eqIdx).trim()
          let v = trimmed.slice(eqIdx + 1).trim()
          // quitar comillas si existen
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1)
          }
          if (!process.env[k]) process.env[k] = v
        }
      }
    } catch {
      // ignorar error de carga manual
    }
  }

  // Fallback para tests: si aún no hay SECRET y estamos en test, usar secreto determinístico
  // Esto permite que `vitest run` pase sin necesidad de export SESSION_SECRET en CI,
  // pero en production/development mantiene fail-fast estricto.
  if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'test') {
    process.env.SESSION_SECRET = 'test-secret-32-chars-long-xxxxxxxxxxxxxxxxxxxxxxxx'
  }

  // Fallback genérico: AI_API_KEY || ANTHROPIC_API_KEY (compat 1 sprint)
  // Se usa `||` (no `??`) porque docker-compose propaga `${AI_API_KEY:-}` como ""
  // y "" no debe bloquear el fallback. `|| undefined` normaliza "" a undefined.
  const aiApiKey = process.env.AI_API_KEY || process.env.ANTHROPIC_API_KEY || undefined

  const raw = {
    SESSION_SECRET: process.env.SESSION_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV as string | undefined,
    AI_API_KEY: aiApiKey,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    AI_BASE_URL: process.env.AI_BASE_URL,
    AI_MODEL: process.env.AI_MODEL,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
    TELEGRAM_WEBHOOK_URL: process.env.TELEGRAM_WEBHOOK_URL,
    LINK_CODE_TTL_SECONDS: process.env.LINK_CODE_TTL_SECONDS,
    BREVO_API_KEY: process.env.BREVO_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM || process.env.BREVO_SENDER_EMAIL || undefined,
    BREVO_SENDER_EMAIL: process.env.BREVO_SENDER_EMAIL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
    REMINDER_SWEEP_SECRET: process.env.REMINDER_SWEEP_SECRET,
  }

  const result = envSchema.safeParse(raw)
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`[env] Invalid environment variables: ${msg}`)
  }
  return result.data
}

export const env = parseEnv()
export type Env = typeof env
