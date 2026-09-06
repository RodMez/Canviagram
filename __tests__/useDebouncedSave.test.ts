import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createNodeSaveFn, createPositionSaveFn } from '@/hooks/useDebouncedSave'
import { createDebouncer } from '@/lib/utils/debounce'

// ============================================================
// Tests for pure helper functions
// createNodeSaveFn / createPositionSaveFn
//
// Limitación documentada:
// useDebouncedSave (el hook React) requiere DOM (jsdom) y
// @testing-library/react para renderHook. El entorno de tests
// es 'node' y testing-library no está instalado.
// Estos helpers son funciones puras exportadas que se pueden
// testear directamente con fetch mock.
// ============================================================

const mockFetch = vi.fn()
const originalFetch = global.fetch

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = mockFetch as unknown as typeof fetch
})

afterEach(() => {
  global.fetch = originalFetch
})

describe('createNodeSaveFn', () => {
  it('hace PATCH con body correcto y retorna void en éxito', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    })

    const saveFn = createNodeSaveFn('ws-1', 'n1', 'user-1')
    await saveFn({ title: 'Nuevo título', content: 'Contenido' })

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/workspaces/ws-1/nodes/n1',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Nuevo título', content: 'Contenido' }),
      }
    )
  })

  it('lanza error con mensaje del servidor en respuesta fallida', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({ error: 'Validación fallida' }),
    })

    const saveFn = createNodeSaveFn('ws-1', 'n1', 'user-1')
    await expect(saveFn({ title: 'X' })).rejects.toThrow('Validación fallida')
  })

  it('lanza error genérico si res.json() falla', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: vi.fn().mockRejectedValue(new Error('parse error')),
    })

    const saveFn = createNodeSaveFn('ws-1', 'n1', 'user-1')
    await expect(saveFn({ title: 'X' })).rejects.toThrow('Error')
  })
})

describe('createPositionSaveFn', () => {
  it('hace PATCH con posición y retorna void en éxito', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    })

    const saveFn = createPositionSaveFn('ws-1', 'n1')
    await saveFn({ positionX: 100, positionY: 200 })

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/workspaces/ws-1/nodes/n1',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionX: 100, positionY: 200 }),
      }
    )
  })

  it('lanza error genérico en respuesta fallida', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({}),
    })

    const saveFn = createPositionSaveFn('ws-1', 'n1')
    await expect(saveFn({ positionX: 0, positionY: 0 })).rejects.toThrow(
      'Error guardando posición'
    )
  })
})

describe('useDebouncedSave hook', () => {
  it('useDebouncedSave es exportado como función', async () => {
    // Dynamic import para verificar que el módulo exporta la función
    const mod = await import('@/hooks/useDebouncedSave')
    expect(typeof mod.useDebouncedSave).toBe('function')
  })

  it('createNodeSaveFn retorna función asíncrona', () => {
    const fn = createNodeSaveFn('ws-1', 'n1', 'user-1')
    expect(typeof fn).toBe('function')
  })

  it('createPositionSaveFn retorna función asíncrona', () => {
    const fn = createPositionSaveFn('ws-1', 'n1')
    expect(typeof fn).toBe('function')
  })
})

// ============================================================
// Primitivo puro createDebouncer (Deuda M1, Diseño 9.2/13)
// La lógica crítica de debounce/flush/cancel se prueba aquí con
// fake timers de vitest, sin necesidad de jsdom.
// ============================================================

describe('createDebouncer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('trigger invoca fn tras el delay', () => {
    const fn = vi.fn().mockResolvedValue(undefined)
    const d = createDebouncer(fn, 500)

    d.trigger('v1')
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(499)
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('v1')
  })

  it('flush invoca fn inmediatamente con el valor pendiente', () => {
    const fn = vi.fn().mockResolvedValue(undefined)
    const d = createDebouncer(fn, 500)

    d.trigger('v1')
    d.flush()

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('v1')
  })

  it('cancel no emite y descarta el valor pendiente', () => {
    const fn = vi.fn().mockResolvedValue(undefined)
    const d = createDebouncer(fn, 500)

    d.trigger('v1')
    d.cancel()

    vi.advanceTimersByTime(1000)
    expect(fn).not.toHaveBeenCalled()
  })

  it('última llamada gana (solo se emite el último valor)', () => {
    const fn = vi.fn().mockResolvedValue(undefined)
    const d = createDebouncer(fn, 500)

    d.trigger('v1')
    vi.advanceTimersByTime(200)
    d.trigger('v2')
    vi.advanceTimersByTime(200)
    d.trigger('v3')

    vi.advanceTimersByTime(500)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('v3')
  })
})