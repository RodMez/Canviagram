import { describe, it, expect } from 'vitest'
import {
  sortColumns,
  mappedStatus,
  groupTasksByColumn,
  sortTasksByOrder,
  hasDuplicateTitle,
  columnForStatus,
  BOARD_ORDER_GAP,
} from '@/lib/canvas/board-columns'
import {
  computeBoardOrder,
  needsRenormalize,
  neighboursForIndex,
  orderForMoveToIndex,
  renormalizeOrders,
} from '@/lib/canvas/board-move'
import type { BoardColumn, Node } from '@/lib/db/schema'

// ============================================================
// builders
// ============================================================

function makeColumn(overrides: Partial<BoardColumn> = {}): BoardColumn {
  return {
    id: 'c1',
    workspaceId: 'ws1',
    title: 'Por hacer',
    position: 0,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  }
}

function makeTask(overrides: Partial<Node> = {}): Node {
  return {
    id: 't1',
    workspaceId: 'ws1',
    createdBy: 'u1',
    type: 'task',
    title: 'T',
    content: null,
    status: 'todo',
    priority: null,
    effort: null,
    assigneeId: null,
    boardColumnId: 'c1',
    boardOrder: 1000,
    positionX: 0,
    positionY: 0,
    dueDate: null,
    reminderOffsetMin: null,
    notifiedAt: null,
    recurrenceRule: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
    ...overrides,
  }
}

// ============================================================
// sortColumns
// ============================================================

describe('sortColumns', () => {
  it('ordena por position asc (title como desempate)', () => {
    const cols = [
      makeColumn({ id: 'b', title: 'B', position: 2000 }),
      makeColumn({ id: 'a', title: 'A', position: 1000 }),
      makeColumn({ id: 'c', title: 'C', position: 1000 }),
    ]
    // 'A' y 'C' empatan en 1000 → desempate por title.
    expect(sortColumns(cols).map((c) => c.id)).toEqual(['a', 'c', 'b'])
  })
})

// ============================================================
// mappedStatus — regla posicional primera→todo última→done
// ============================================================

describe('mappedStatus', () => {
  const cols = [
    makeColumn({ id: 'first', position: 0 }),
    makeColumn({ id: 'mid', position: 1000 }),
    makeColumn({ id: 'last', position: 2000 }),
  ]

  it('primera columna → todo', () => {
    expect(mappedStatus('first', cols)).toBe('todo')
  })
  it('intermedia → in_progress', () => {
    expect(mappedStatus('mid', cols)).toBe('in_progress')
  })
  it('última → done', () => {
    expect(mappedStatus('last', cols)).toBe('done')
  })
  it('columna desconocida → todo (fallback seguro)', () => {
    expect(mappedStatus('nope', cols)).toBe('todo')
  })
  it('lista vacía → todo', () => {
    expect(mappedStatus('x', [])).toBe('todo')
  })
  it('una sola columna → todo (no hay última distinta de la primera)', () => {
    expect(mappedStatus('only', [makeColumn({ id: 'only' })])).toBe('todo')
  })
  it('2 columnas → todo/done', () => {
    const two = cols.filter((c) => c.id !== 'mid')
    expect(mappedStatus('first', two)).toBe('todo')
    expect(mappedStatus('last', two)).toBe('done')
  })
})

// ============================================================
// groupTasksByColumn
// ============================================================

describe('groupTasksByColumn', () => {
  it('agrupa tasks por columna y ordena por boardOrder', () => {
    const cols = [makeColumn({ id: 'a', position: 0 }), makeColumn({ id: 'b', position: 1000 })]
    const nodes = [
      makeTask({ id: 't2', boardColumnId: 'a', boardOrder: 2000 }),
      makeTask({ id: 't1', boardColumnId: 'a', boardOrder: 1000 }),
      makeTask({ id: 't3', boardColumnId: 'b', boardOrder: 1000 }),
      makeTask({ id: 'n1', type: 'note', boardColumnId: null }),
    ]
    const { byColumn, unassigned } = groupTasksByColumn(nodes, cols)
    expect(byColumn['a'].map((n) => n.id)).toEqual(['t1', 't2']) // sorted by boardOrder
    expect(byColumn['b'].map((n) => n.id)).toEqual(['t3'])
    expect(unassigned).toEqual([]) // los no-task no van a unassigned
  })

  it('task sin columna cae en la primera', () => {
    const cols = [makeColumn({ id: 'first', position: 0 }), makeColumn({ id: 'second', position: 1000 })]
    const { byColumn } = groupTasksByColumn([makeTask({ id: 'orphan', boardColumnId: null })], cols)
    expect(byColumn['first'].map((n) => n.id)).toEqual(['orphan'])
    expect(byColumn['second']).toEqual([])
  })

  it('columna inexistente → primera también (no pierde la tarea)', () => {
    const cols = [makeColumn({ id: 'first', position: 0 })]
    const { byColumn } = groupTasksByColumn([makeTask({ id: 'ghost', boardColumnId: 'deleted-col' })], cols)
    expect(byColumn['first'].map((n) => n.id)).toEqual(['ghost'])
  })

  it('sin columnas → unassigned', () => {
    const { unassigned } = groupTasksByColumn([makeTask({ id: 't' })], [])
    expect(unassigned.map((n) => n.id)).toEqual(['t'])
  })
})

// ============================================================
// sortTasksByOrder + hasDuplicateTitle + columnForStatus
// ============================================================

describe('sortTasksByOrder', () => {
  it('ordena asc por boardOrder', () => {
    const tasks = [makeTask({ id: 'b', boardOrder: 2 }), makeTask({ id: 'a', boardOrder: 1 })]
    expect(sortTasksByOrder(tasks).map((t) => t.id)).toEqual(['a', 'b'])
  })
})

describe('hasDuplicateTitle', () => {
  it('detecta duplicados NOCASE', () => {
    const cols = [makeColumn({ id: 'a', title: 'En progreso' })]
    expect(hasDuplicateTitle(cols, 'EN PROGRESO')).toBe(true)
    expect(hasDuplicateTitle(cols, 'en progreso')).toBe(true)
    expect(hasDuplicateTitle(cols, 'Hecho')).toBe(false)
  })
  it('excludeId permite renombrar a sí mismo', () => {
    const cols = [makeColumn({ id: 'a', title: 'Hecho' })]
    expect(hasDuplicateTitle(cols, 'HECHO', 'a')).toBe(false)
  })
})

describe('columnForStatus', () => {
  const cols = [
    makeColumn({ id: 'a', position: 0 }),
    makeColumn({ id: 'b', position: 1000 }),
    makeColumn({ id: 'c', position: 2000 }),
  ]
  it('encuentra la primera columna con ese status mapeado', () => {
    expect(columnForStatus(cols, 'todo')?.id).toBe('a')
    expect(columnForStatus(cols, 'in_progress')?.id).toBe('b')
    expect(columnForStatus(cols, 'done')?.id).toBe('c')
  })
  it('devuelve undefined si no hay columnas', () => {
    expect(columnForStatus([], 'todo')).toBeUndefined()
  })
})

// ============================================================
// lib/canvas/board-move.ts
// ============================================================

describe('computeBoardOrder', () => {
  it('columna vacía → GAP (1000)', () => {
    expect(computeBoardOrder(null, null)).toBe(BOARD_ORDER_GAP)
  })
  it('solo next → next - GAP (prepend)', () => {
    expect(computeBoardOrder(null, 2000)).toBe(1000)
  })
  it('solo prev → prev + GAP (append)', () => {
    expect(computeBoardOrder(1000, null)).toBe(2000)
  })
  it('ambos → punto medio', () => {
    expect(computeBoardOrder(1000, 2000)).toBe(1500)
  })
})

describe('needsRenormalize', () => {
  it('true cuando el gap colapsa', () => {
    expect(needsRenormalize(1000, 1000.0001)).toBe(true)
  })
  it('false con margen razonable', () => {
    expect(needsRenormalize(1000, 1000.01)).toBe(false)
  })
})

describe('neighboursForIndex', () => {
  const sorted = [1000, 2000, 3000]
  it('índice 0 → solo next', () => {
    expect(neighboursForIndex(sorted, 0)).toEqual({ prev: null, next: 1000 })
  })
  it('índice len → solo prev', () => {
    expect(neighboursForIndex(sorted, 3)).toEqual({ prev: 3000, next: null })
  })
  it('índice intermedio → ambos', () => {
    expect(neighboursForIndex(sorted, 1)).toEqual({ prev: 1000, next: 2000 })
  })
  it('índice > len → clampea', () => {
    expect(neighboursForIndex(sorted, 99)).toEqual({ prev: 3000, next: null })
  })
  it('índice negativo → clampea', () => {
    expect(neighboursForIndex(sorted, -5)).toEqual({ prev: null, next: 1000 })
  })
})

describe('orderForMoveToIndex', () => {
  it('inserta al inicio', () => {
    expect(orderForMoveToIndex([1000, 2000], 0)).toBe(1000 - BOARD_ORDER_GAP)
  })
  it('inserta al final', () => {
    expect(orderForMoveToIndex([1000, 2000], 2)).toBe(3000)
  })
  it('inserta en medio', () => {
    expect(orderForMoveToIndex([1000, 2000], 1)).toBe(1500)
  })
  it('columna vacía → GAP', () => {
    expect(orderForMoveToIndex([], 0)).toBe(BOARD_ORDER_GAP)
  })
})

describe('renormalizeOrders', () => {
  it('reescribe a gaps *1000 preservando orden relativo', () => {
    const tasks = [makeTask({ id: 'a', boardOrder: 1500 }), makeTask({ id: 'b', boardOrder: 1500.001 })]
    const out = renormalizeOrders(tasks)
    expect(out).toEqual([
      { id: 'a', boardOrder: 1000 },
      { id: 'b', boardOrder: 2000 },
    ])
  })
})