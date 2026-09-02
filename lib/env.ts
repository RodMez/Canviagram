import fs from 'fs'
import path from 'path'
import { z } from 'zod'

const envSchema = z
  .object({
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    DATABASE_URL: z.string().optional().default('canviagram.db'),
    NODE_ENV: z.enum(['development', 'test', 'production']).optional().default('development'),
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

  const raw = {
    SESSION_SECRET: process.env.SESSION_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV as string | undefined,
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
