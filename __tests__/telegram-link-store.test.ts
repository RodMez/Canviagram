import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { randomBytes as realRandomBytes } from 'node:crypto'

// Mock parcial de crypto: randomBytes es un vi.fn con la implementación real por defecto,
// para poder forzar colisiones en el test de regeneración (diseño F4.2 §7.1).
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>()
  return { ...actual, randomBytes: vi.fn(actual.randomBytes) }
})

import { createLinkCode, consumeLinkCode, _size, _clear } from '@/lib/telegram/link-store'
import { TG_ALPHABET } from '@/lib/telegram/config'
import { randomBytes } from 'crypto'

const mRandomBytes = vi.mocked(randomBytes)

describe('lib/telegram/link-store', () => {
  beforeEach(() => {
    _clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('createLinkCode → código 8 chars del alfabeto, expiresAt ≈ now + 600s, _size=1', () => {
    const before = Date.now()
    const { code, expiresAt } = createLinkCode({ workspaceId: 'ws-1', userId: 'u1' })
    const after = Date.now()

    expect(code).toHaveLength(8)
    for (const ch of code) {
      expect(TG_ALPHABET).toContain(ch)
    }
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 600_000)
    expect(expiresAt.getTime()).toBeLessThanOrEqual(after + 600_000)
    expect(_size()).toBe(1)
  })

  it('normalización: consumeLinkCode(" k7x2m9 ") consume K7X2M9 (trim + upper)', () => {
    const { code } = createLinkCode({ workspaceId: 'ws-1', userId: 'u1' })
    const result = consumeLinkCode(` ${code.toLowerCase()} `)
    expect(result).toEqual({ ok: true, workspaceId: 'ws-1', userId: 'u1' })
  })

  it('single-use: primer consume ok, segundo → not_found', () => {
    const { code } = createLinkCode({ workspaceId: 'ws-1', userId: 'u1' })
    expect(consumeLinkCode(code)).toEqual({ ok: true, workspaceId: 'ws-1', userId: 'u1' })
    expect(consumeLinkCode(code)).toEqual({ ok: false, reason: 'not_found' })
  })

  it('TTL: código expirado tras 10 min → reason expired', () => {
    vi.useFakeTimers()
    const { code } = createLinkCode({ workspaceId: 'ws-1', userId: 'u1' })
    vi.advanceTimersByTime(601_000)
    expect(consumeLinkCode(code)).toEqual({ ok: false, reason: 'expired' })
  })

  it('sweep: al insertar se purgan los expirados (no bloquean el cap)', () => {
    vi.useFakeTimers()
    // 50 expirados (TTL 1ms) + 50 vivos = 100 = cap
    for (let i = 0; i < 50; i++) {
      createLinkCode({ workspaceId: `ws-exp-${i}`, userId: 'u1' }, { ttlSeconds: 0.001, maxCodes: 100 })
    }
    vi.advanceTimersByTime(10)
    for (let i = 0; i < 50; i++) {
      createLinkCode({ workspaceId: `ws-live-${i}`, userId: 'u1' }, { ttlSeconds: 600, maxCodes: 100 })
    }
    // Cada insert purgó los expirados → solo quedan los 50 vivos
    expect(_size()).toBe(50)

    // Insertar uno más → sweep purga los 50 expirados → entra sin llegar al cap
    const { code } = createLinkCode({ workspaceId: 'ws-new', userId: 'u1' }, { ttlSeconds: 600, maxCodes: 100 })
    expect(code).toHaveLength(8)
    expect(_size()).toBe(51)
  })

  it('cap: todos vivos y en cap → lanza error', () => {
    for (let i = 0; i < 100; i++) {
      createLinkCode({ workspaceId: `ws-${i}`, userId: 'u1' }, { ttlSeconds: 600, maxCodes: 100 })
    }
    expect(() =>
      createLinkCode({ workspaceId: 'ws-over', userId: 'u1' }, { ttlSeconds: 600, maxCodes: 100 })
    ).toThrow('Límite de códigos')
  })

  it('colisión: regenera si el código ya existe', () => {
    const zeroBytes = Buffer.alloc(8, 0) // → 'AAAAAAAA'
    const oneBytes = Buffer.alloc(8, 1) // → 'BBBBBBBB'
    let call = 0
    mRandomBytes.mockImplementation((size: number) => {
      call++
      return call === 1 ? zeroBytes : oneBytes
    })
    try {
      const first = createLinkCode({ workspaceId: 'ws-1', userId: 'u1' })
      const second = createLinkCode({ workspaceId: 'ws-2', userId: 'u1' })
      expect(first.code).toBe('AAAAAAAA')
      expect(second.code).toBe('BBBBBBBB')
      expect(second.code).not.toBe(first.code)
    } finally {
      mRandomBytes.mockImplementation(realRandomBytes)
    }
  })
})