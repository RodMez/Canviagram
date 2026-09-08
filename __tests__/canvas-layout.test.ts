import { describe, it, expect } from 'vitest'
import {
  positionForIndex,
  occupiedIndex,
  findFreeSlots,
  slotForIndex,
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

describe('occupiedIndex (mapeo posición → slot)', () => {
  it('posición exacta de slot → su índice', () => {
    expect(occupiedIndex(0, 0)).toBe(0)
    expect(occupiedIndex(NODE_GRID_WIDTH, 0)).toBe(1)
    expect(occupiedIndex(NODE_GRID_WIDTH * 3, NODE_GRID_HEIGHT)).toBe(GRID_COLUMNS + 3)
  })

  it('arrastro dentro de la celda redondea al slot más cercano', () => {
    expect(occupiedIndex(10, 0)).toBe(0)
    expect(occupiedIndex(NODE_GRID_WIDTH - 1, 5)).toBe(0)
    expect(occupiedIndex(NODE_GRID_WIDTH + 60, 50)).toBe(1)
  })

  it('coordenadas negativas se tratan como slot 0', () => {
    expect(occupiedIndex(-50, -20)).toBe(0)
  })
})

describe('findFreeSlots (primer slot libre — fix de solapes)', () => {
  it('concede slots secuenciales sin ocupados', () => {
    expect(findFreeSlots(new Set(), 3)).toEqual([0, 1, 2])
  })

  it('salta slots ocupados (post-borrado el índice de count reutilizaría un slot ocupado)', () => {
    // escenario del bug: 3 nodos en slots 0..2, se borra el del medio (slot 1)
    const occupied = new Set([0, 2])
    expect(findFreeSlots(occupied, 1)).toEqual([1])
  })

  it('evita colisión con el siguiente slot vivo', () => {
    // nodos vivos en 0,1,2 → el nuevo debe ir a 3, NO a 2 (bug del count)
    const occupied = new Set([0, 1, 2])
    expect(findFreeSlots(occupied, 1)).toEqual([3])
  })

  it('varios slots en lote desde un bloque ocupado', () => {
    const occupied = new Set([0, 1, 5])
    expect(findFreeSlots(occupied, 4)).toEqual([2, 3, 4, 6])
  })

  it('startIndex respeta el inicio (zona libre para templates)', () => {
    const occupied = new Set([0, 1, 2])
    expect(findFreeSlots(occupied, 2, 3)).toEqual([3, 4])
  })

  it('startIndex negativo o no-finito → 0', () => {
    expect(findFreeSlots(new Set(), 1, -2)).toEqual([0])
    expect(findFreeSlots(new Set(), 1, Number.NaN)).toEqual([0])
  })
})

describe('slotForIndex (columna/fila)', () => {
  it('index 0 → {col:0,row:0}', () => {
    expect(slotForIndex(0)).toEqual({ col: 0, row: 0 })
  })

  it('index GRID_COLUMNS → {col:0,row:1}', () => {
    expect(slotForIndex(GRID_COLUMNS)).toEqual({ col: 0, row: 1 })
  })
})