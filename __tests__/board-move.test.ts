import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { resolveDropTarget } from '@/components/board/Board'
import { useBoardStore } from '@/store/board-store'
import { useCanvasStore } from '@/store/canvas-store'
import type { BoardColumn, Node } from '@/lib/db/schema'

function makeColumn(overrides: Partial<BoardColumn> = {}): BoardColumn {
  return {
    id: 'c1',
    workspaceId: 'demo',
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
    workspaceId: 'demo',
    createdBy: 'demo',
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
// resolveDropTarget (Board DnD): over.id puede ser un droppable
// `col:<id>` (columna vacía) o el id de una tarjeta (sortable).
// ============================================================

describe('resolveDropTarget', () => {
  const tasksByColumn = {
    c1: [makeTask({ id: 't1' }), makeTask({ id: 't2' })],
    c2: [makeTask({ id: 't3' })],
  }

  it('columna droppable → append al final', () => {
    expect(resolveDropTarget('col:c1', tasksByColumn)).toEqual({ columnId: 'c1', indexInColumn: 2 })
  })

  it('columna vacía → index 0', () => {
    expect(resolveDropTarget('col:vacia', tasksByColumn)).toEqual({ columnId: 'vacia', indexInColumn: 0 })
  })

  it('tarjeta → su columna y su índice', () => {
    expect(resolveDropTarget('t2', tasksByColumn)).toEqual({ columnId: 'c1', indexInColumn: 1 })
  })

  it('tarjeta solitaria → index 0', () => {
    expect(resolveDropTarget('t3', tasksByColumn)).toEqual({ columnId: 'c2', indexInColumn: 0 })
  })

  it('id desconocido → null', () => {
    expect(resolveDropTarget('n-unrelated', tasksByColumn)).toEqual({ columnId: null, indexInColumn: 0 })
  })
})

// ============================================================
// board-store: createColumn / renameColumn / deleteColumn en modo DEMO
// (mutan el store en local sin tocar la red).
// ============================================================

describe('board-store (demo)', () => {
  beforeEach(() => {
    useBoardStore.setState({ columns: [], columnsLoadedFor: null, pendingMove: false })
    useCanvasStore.setState({ nodes: [], edges: [], selectedNodeId: null, isPanelCollapsed: false, demoMode: false })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('createColumn añade una columna al final (demo)', async () => {
    useBoardStore.getState().setColumns([makeColumn({ id: 'base', position: 0 })], 'demo')
    const col = await useBoardStore.getState().createColumn('demo', 'Revisión')
    expect(col?.title).toBe('Revisión')
    const cols = useBoardStore.getState().columns
    expect(cols.map((c) => c.id)).toContain(col!.id)
    expect(cols[cols.length - 1].id).toBe(col!.id)
  })

  it('renameColumn actualiza el título (demo)', async () => {
    useBoardStore.getState().setColumns([makeColumn({ id: 'base', title: 'Old' })], 'demo')
    await useBoardStore.getState().renameColumn('demo', 'base', 'Nuevo')
    expect(useBoardStore.getState().columns[0].title).toBe('Nuevo')
  })

  it('deleteColumn elimina y rehominga tareas a la primera restante (demo)', async () => {
    useBoardStore.getState().setColumns(
      [makeColumn({ id: 'a', position: 0 }), makeColumn({ id: 'b', position: 1000 })],
      'demo'
    )
    useCanvasStore.getState().loadGraph([makeTask({ id: 't1', boardColumnId: 'a' })], [])
    await useBoardStore.getState().deleteColumn('demo', 'a')
    const cols = useBoardStore.getState().columns
    expect(cols.map((c) => c.id)).toEqual(['b'])
    expect(useCanvasStore.getState().nodes.find((n) => n.id === 't1')?.boardColumnId).toBe('b')
  })

  it('moveTask en demo cambia columna + status sin fetch', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no debe llamar fetch'))))
    useBoardStore.getState().setColumns(
      [makeColumn({ id: 'a', position: 0 }), makeColumn({ id: 'b', position: 1000 })],
      'demo'
    )
    useCanvasStore.getState().loadGraph([makeTask({ id: 't1', boardColumnId: 'a', status: 'todo' })], [])
    await useBoardStore.getState().moveTask('demo', 't1', 'b', 1000)
    const n = useCanvasStore.getState().nodes.find((x) => x.id === 't1')
    expect(n?.boardColumnId).toBe('b')
    // mappedStatus(b, [a,b]) → done (última posición del demo)
    expect(n?.status).toBe('done')
  })
})