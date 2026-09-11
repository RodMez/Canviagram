import { describe, it, expect } from 'vitest'
import { computeDagreLayout } from '@/lib/canvas/dagre-layout'

// ============================================================
// F5.2: layout jerárquico con dagre
// ============================================================

describe('computeDagreLayout', () => {
  it('cadena A→B→C: positionY estrictamente creciente por rank', () => {
    const positions = computeDagreLayout(
      ['a', 'b', 'c'],
      [
        { sourceId: 'a', targetId: 'b' },
        { sourceId: 'b', targetId: 'c' },
      ]
    )
    expect(positions.size).toBe(3)
    const ya = positions.get('a')!.y
    const yb = positions.get('b')!.y
    const yc = positions.get('c')!.y
    expect(yb).toBeGreaterThan(ya)
    expect(yc).toBeGreaterThan(yb)
  })

  it('retorna una posición por cada nodo, sin NaN', () => {
    const positions = computeDagreLayout(
      ['a', 'b', 'c', 'solo'],
      [
        { sourceId: 'a', targetId: 'b' },
        { sourceId: 'b', targetId: 'c' },
      ]
    )
    expect(positions.size).toBe(4)
    for (const pos of positions.values()) {
      expect(Number.isFinite(pos.x)).toBe(true)
      expect(Number.isFinite(pos.y)).toBe(true)
    }
  })

  it('nodos desconectados también reciben posición', () => {
    const positions = computeDagreLayout(['x', 'y'], [])
    expect(positions.size).toBe(2)
    expect(positions.get('x')).toBeDefined()
    expect(positions.get('y')).toBeDefined()
  })

  it('ignora edges a nodos inexistentes y self-loops sin romper', () => {
    const positions = computeDagreLayout(['a', 'b'], [
      { sourceId: 'a', targetId: 'b' },
      { sourceId: 'a', targetId: 'fantasma' },
      { sourceId: 'a', targetId: 'a' },
    ])
    expect(positions.size).toBe(2)
    expect(positions.get('b')!.y).toBeGreaterThan(positions.get('a')!.y)
  })
})
