import { describe, it, expect } from 'vitest'
import {
  positionForIndex,
  GRID_COLUMNS,
  NODE_GRID_WIDTH,
  NODE_GRID_HEIGHT,
} from '@/lib/canvas/layout'

describe('positionForIndex (auto-layout en grilla)', () => {
  it('index 0 → esquina (0,0)', () => {
    expect(positionForIndex(0)).toEqual({ x: 0, y: 0 })
  })

  it('index 1 → primera columna, misma fila', () => {
    expect(positionForIndex(1)).toEqual({ x: NODE_GRID_WIDTH, y: 0 })
  })

  it('index GRID_COLUMNS-1 → última columna de la primera fila', () => {
    expect(positionForIndex(GRID_COLUMNS - 1)).toEqual({
      x: (GRID_COLUMNS - 1) * NODE_GRID_WIDTH,
      y: 0,
    })
  })

  it('index GRID_COLUMNS → baja a la segunda fila (x vuelve a 0)', () => {
    expect(positionForIndex(GRID_COLUMNS)).toEqual({ x: 0, y: NODE_GRID_HEIGHT })
  })

  it('sin solapamientos: 12 nodos ocupan filas distintas en x/y', () => {
    const positions = Array.from({ length: 12 }, (_, i) => positionForIndex(i))
    const seen = new Set(positions.map((p) => `${p.x},${p.y}`))
    expect(seen.size).toBe(12)
  })

  it('index negativo o no-finito se trata como 0 (defensa)', () => {
    expect(positionForIndex(-3)).toEqual({ x: 0, y: 0 })
    expect(positionForIndex(Number.NaN)).toEqual({ x: 0, y: 0 })
  })
})