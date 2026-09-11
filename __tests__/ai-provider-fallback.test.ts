import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ai/settings', () => ({
  getAiSettings: vi.fn(),
  notifyAdminsOfFallback: vi.fn(async () => {}),
}))

import { callWithFallback, isModelUnavailableError } from '@/lib/ai/provider'
import { getAiSettings, notifyAdminsOfFallback } from '@/lib/ai/settings'

const mSettings = vi.mocked(getAiSettings)
const mNotify = vi.mocked(notifyAdminsOfFallback)

// ============================================================
// F5.5b: fallback automático de modelo
// ============================================================

function unavailable(statusCode: number, message = 'x') {
  const err = new Error(message) as Error & { statusCode: number }
  err.statusCode = statusCode
  return err
}

describe('isModelUnavailableError', () => {
  it('detecta 404/429 y mensajes de modelo o cuota', () => {
    expect(isModelUnavailableError(unavailable(404, 'x'))).toBe(true)
    expect(isModelUnavailableError(unavailable(429, 'x'))).toBe(true)
    expect(isModelUnavailableError(new Error('Model not found: foo/bar'))).toBe(true)
    expect(isModelUnavailableError(new Error('Rate limit exceeded, retry later'))).toBe(true)
    expect(isModelUnavailableError(unavailable(400, 'Model foo is deprecated'))).toBe(true)
  })

  it('no clasifica errores comunes como falta de modelo', () => {
    expect(isModelUnavailableError(new Error('AI_API_KEY no configurado'))).toBe(false)
    expect(isModelUnavailableError(unavailable(500, 'Internal Server Error'))).toBe(false)
    expect(isModelUnavailableError(unavailable(400, 'Bad request: invalid JSON'))).toBe(false)
    expect(isModelUnavailableError(null)).toBe(false)
    expect(isModelUnavailableError(undefined)).toBe(false)
  })
})

describe('callWithFallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mSettings.mockResolvedValue({ model: 'm-primary', fallback: ['m-fallback'] })
  })

  it('éxito al primer intento: sin fallback ni aviso', async () => {
    const fn = vi.fn(async (model: unknown) => `ok:${String(model)}`)
    const result = await callWithFallback(fn)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(mNotify).not.toHaveBeenCalled()
    expect(typeof result).toBe('string')
  })

  it('modelo caído → reintenta con fallback y avisa al admin una vez', async () => {
    const seen: unknown[] = []
    const fn = vi.fn(async (model: unknown) => {
      seen.push(model)
      if (seen.length === 1) throw unavailable(404, 'Model not found: m-primary')
      return 'recovered'
    })
    const result = await callWithFallback(fn)
    expect(result).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(2)
    expect(mNotify).toHaveBeenCalledTimes(1)
    expect(mNotify).toHaveBeenCalledWith('m-primary', 'm-fallback')
  })

  it('error que no es de disponibilidad se propaga sin reintentar', async () => {
    const fn = vi.fn(async () => {
      throw new Error('boom inesperado')
    })
    await expect(callWithFallback(fn)).rejects.toThrow('boom inesperado')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(mNotify).not.toHaveBeenCalled()
  })

  it('si se agotan los candidatos, lanza el último error', async () => {
    const fn = vi.fn(async () => {
      throw unavailable(429, 'Rate limit exceeded')
    })
    await expect(callWithFallback(fn)).rejects.toThrow('Rate limit exceeded')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('sin fallback configurado: un solo intento + aviso sin next', async () => {
    mSettings.mockResolvedValue({ model: 'm-only', fallback: [] })
    const fn = vi.fn(async () => {
      throw unavailable(404, 'Model not found')
    })
    await expect(callWithFallback(fn)).rejects.toThrow('Model not found')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(mNotify).toHaveBeenCalledWith('m-only', undefined)
  })
})
