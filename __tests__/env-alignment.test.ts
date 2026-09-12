import { describe, it, expect, vi, afterEach } from 'vitest'

const MANAGED_KEYS = [
  'SESSION_SECRET',
  'DATABASE_URL',
  'NODE_ENV',
  'AI_API_KEY',
  'ANTHROPIC_API_KEY',
  'AI_BASE_URL',
  'AI_MODEL',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'TELEGRAM_WEBHOOK_URL',
  'LINK_CODE_TTL_SECONDS',
  'BREVO_API_KEY',
  'EMAIL_FROM',
  'BREVO_SENDER_EMAIL',
  'NEXT_PUBLIC_APP_URL',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
  'REMINDER_SWEEP_SECRET',
] as const

const savedEnv: Record<string, string | undefined> = {}
for (const k of MANAGED_KEYS) savedEnv[k] = process.env[k]

afterEach(() => {
  for (const k of MANAGED_KEYS) {
    const v = savedEnv[k]
    if (v === undefined) delete process.env[k]
    else (process.env as Record<string, string | undefined>)[k] = v
  }
  vi.resetModules()
})

async function loadFreshEnv(overrides: Record<string, string | undefined>) {
  vi.resetModules()
  for (const k of MANAGED_KEYS) delete process.env[k]
  process.env.SESSION_SECRET = 'test-secret-32-chars-long-xxxxxxxxxxxxxxxxxxxxxxxx'
  ;(process.env as Record<string, string | undefined>).NODE_ENV = 'test'
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  const mod = await import('@/lib/env')
  return mod.env
}

describe('env alignment: centralización en lib/env.ts', () => {
  it('defaults: TTL 600 y WEBHOOK_URL undefined cuando no se configuran', async () => {
    const env = await loadFreshEnv({})
    expect(env.LINK_CODE_TTL_SECONDS).toBe(600)
    expect(env.TELEGRAM_WEBHOOK_URL).toBeUndefined()
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  })

  it('empty-string en WEBHOOK_URL se normaliza a undefined (no rompe arranque)', async () => {
    const env = await loadFreshEnv({ TELEGRAM_WEBHOOK_URL: '' })
    expect(env.TELEGRAM_WEBHOOK_URL).toBeUndefined()
  })

  it('WEBHOOK_URL válida se conserva', async () => {
    const env = await loadFreshEnv({
      TELEGRAM_WEBHOOK_URL: 'https://tu-dominio/api/telegram/webhook',
    })
    expect(env.TELEGRAM_WEBHOOK_URL).toBe('https://tu-dominio/api/telegram/webhook')
  })

  it('WEBHOOK_URL inválida no vacía falla (fail-fast)', async () => {
    await expect(loadFreshEnv({ TELEGRAM_WEBHOOK_URL: 'not-a-url' })).rejects.toThrow(
      /TELEGRAM_WEBHOOK_URL/,
    )
  })

  it('TTL leniente: valores inválidos caen a 600 sin romper arranque', async () => {
    for (const bad of ['abc', '-5', '0', '']) {
      const env = await loadFreshEnv({ LINK_CODE_TTL_SECONDS: bad })
      expect(env.LINK_CODE_TTL_SECONDS).toBe(600)
    }
  })

  it('TTL válido "300" se coerce a number 300', async () => {
    const env = await loadFreshEnv({ LINK_CODE_TTL_SECONDS: '300' })
    expect(env.LINK_CODE_TTL_SECONDS).toBe(300)
  })

  it('fallback AI_API_KEY ?? ANTHROPIC_API_KEY se mantiene', async () => {
    const env = await loadFreshEnv({ ANTHROPIC_API_KEY: 'sk-ant-test' })
    expect(env.AI_API_KEY).toBe('sk-ant-test')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-test')
  })

  it('AI_API_KEY tiene prioridad sobre ANTHROPIC_API_KEY', async () => {
    const env = await loadFreshEnv({ AI_API_KEY: 'sk-or-test', ANTHROPIC_API_KEY: 'sk-ant-test' })
    expect(env.AI_API_KEY).toBe('sk-or-test')
  })

  it('fallback con AI_API_KEY="" usa ANTHROPIC (docker-compose propaga vacíos como "")', async () => {
    const env = await loadFreshEnv({ AI_API_KEY: '', ANTHROPIC_API_KEY: 'sk-ant-test' })
    expect(env.AI_API_KEY).toBe('sk-ant-test')
  })

  it('fallback con EMAIL_FROM="" usa BREVO_SENDER_EMAIL', async () => {
    const sender = 'sender@example.com'
    const env = await loadFreshEnv({ EMAIL_FROM: '', BREVO_SENDER_EMAIL: sender })
    expect(env.EMAIL_FROM).toBe(sender)
  })

  it('lib/telegram/config usa env centralizado con doble defensa', async () => {
    vi.resetModules()
    for (const k of MANAGED_KEYS) delete process.env[k]
    process.env.SESSION_SECRET = 'test-secret-32-chars-long-xxxxxxxxxxxxxxxxxxxxxxxx'
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'test'
    process.env.LINK_CODE_TTL_SECONDS = '300'
    const config = await import('@/lib/telegram/config')
    expect(config.LINK_CODE_TTL_SECONDS).toBe(300)

    vi.resetModules()
    for (const k of MANAGED_KEYS) delete process.env[k]
    process.env.SESSION_SECRET = 'test-secret-32-chars-long-xxxxxxxxxxxxxxxxxxxxxxxx'
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'test'
    process.env.LINK_CODE_TTL_SECONDS = 'invalido'
    const configFallback = await import('@/lib/telegram/config')
    expect(configFallback.LINK_CODE_TTL_SECONDS).toBe(600)
  })
})
