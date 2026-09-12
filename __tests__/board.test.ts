import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { groupTasksByStatus, otherNodeCounts, blockersOf } from '@/components/board/Board'
import { patchTaskStatus } from '@/lib/canvas/task-status'
import { useCanvasStore } from '@/store/canvas-store'
import type { Node, NodeStatus, Edge } from '@/lib/db/schema'

// ============================================================
// Mock data builders (F6.1: Tablero)
// ============================================================

function makeNode(overrides: Partial<Node> = {}): Node {
  return {
    id: 'n1',
    workspaceId: 'ws-1',
    createdBy: 'user-1',
    type: 'task',
    title: 'Tarea',
    content: null,
    status: 'todo',
    priority: null,
    effort: null,
    assigneeId: null,
    boardColumnId: null,
    boardOrder: 0,
    dueDate: null,
    reminderOffsetMin: null,
    notifiedAt: null,
    recurrenceRule: null,
    positionX: 0,
    positionY: 0,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
    ...overrides,
  }
}

function makeEdge(overrides: Partial<Edge> = {}): Edge {
  return {
    id: 'e1',
    workspaceId: 'ws-1',
    createdBy: 'user-1',
    sourceId: 'n1',
    targetId: 'n2',
    type: 'related_to',
    label: null,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  }
}

// ============================================================
// groupTasksByStatus — agrupación por status
// ============================================================

describe('groupTasksByStatus', () => {
  it('agrupa tasks por status y excluye nodos no-task', () => {
    const nodes = [
      makeNode({ id: 't1', type: 'task', status: 'todo' }),
      makeNode({ id: 't2', type: 'task', status: 'in_progress' }),
      makeNode({ id: 't3', type: 'task', status: 'done' }),
      makeNode({ id: 't4', type: 'task', status: null }), // null → todo
      makeNode({ id: 'n1', type: 'note' }),
      makeNode({ id: 'p1', type: 'person' }),
    ]
    const grouped = groupTasksByStatus(nodes)
    expect(grouped.todo.map((n) => n.id)).toEqual(['t1', 't4'])
    expect(grouped.in_progress.map((n) => n.id)).toEqual(['t2'])
    expect(grouped.done.map((n) => n.id)).toEqual(['t3'])
  })

  it('no inventa columnas con status inválido', () => {
    const grouped = groupTasksByStatus([makeNode({ id: 'x', type: 'task', status: 'bogus' as unknown as NodeStatus })])
    expect(grouped.todo).toHaveLength(0)
    expect(grouped.in_progress).toHaveLength(0)
    expect(grouped.done).toHaveLength(0)
  })
})

// ============================================================
// otherNodeCounts — chip de nodos sin columna (decisión F6.1 #8)
// ============================================================

describe('otherNodeCounts', () => {
  it('cuenta por tipo solo los > 0, en orden canónico', () => {
    const nodes = [
      makeNode({ id: 'n1', type: 'note' }),
      makeNode({ id: 'n2', type: 'note' }),
      makeNode({ id: 'p1', type: 'person' }),
      makeNode({ id: 't1', type: 'task' }),
    ]
    expect(otherNodeCounts(nodes)).toEqual([
      { type: 'note', count: 2 },
      { type: 'person', count: 1 },
    ])
  })

  it('devuelve [] si no hay nodos de otros tipos', () => {
    expect(otherNodeCounts([makeNode({ type: 'task' })])).toEqual([])
  })
})

// ============================================================
// blockersOf — chip "Bloqueada por" (decisión F6.1 #9)
// ============================================================

describe('blockersOf', () => {
  const a = makeNode({ id: 'a', title: 'A', status: 'todo' })
  const b = makeNode({ id: 'b', title: 'B', status: 'in_progress' })
  const c = makeNode({ id: 'c', title: 'C', status: 'done' })

  it('lista targets de depends_on salientes que NO están done', () => {
    const edges = [
      makeEdge({ id: 'e1', sourceId: 'a', targetId: 'b', type: 'depends_on' }),
      makeEdge({ id: 'e2', sourceId: 'a', targetId: 'c', type: 'depends_on' }),
    ]
    const blockers = blockersOf(edges, [a, b, c], a)
    expect(blockers.map((n) => n.id)).toEqual(['b'])
  })

  it('ignora targets done y edges que no son depends_on', () => {
    const edges = [
      makeEdge({ id: 'e1', sourceId: 'a', targetId: 'c', type: 'depends_on' }),
      makeEdge({ id: 'e2', sourceId: 'a', targetId: 'b', type: 'related_to' }),
    ]
    expect(blockersOf(edges, [a, b, c], a)).toEqual([])
  })

  it('ignore edges entrantes (la direccion importa)', () => {
    const edges = [makeEdge({ id: 'e1', sourceId: 'b', targetId: 'a', type: 'depends_on' })]
    expect(blockersOf(edges, [a, b], a)).toEqual([])
  })
})

// ============================================================
// patchTaskStatus — demo vs real (F6.1b)
// ============================================================

describe('patchTaskStatus', () => {
  beforeEach(() => {
    useCanvasStore.setState({
      nodes: [makeNode({ id: 't1', status: 'todo' })],
      edges: [],
      selectedNodeId: null,
      isPanelCollapsed: false,
      demoMode: false,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('demo: aplica cambio local vía applyLocalEvent (cero fetch)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no debe llamar fetch'))))
    const node = useCanvasStore.getState().nodes[0]
    patchTaskStatus('demo', node, 'done')
    expect(useCanvasStore.getState().nodes[0].status).toBe('done')
  })

  it('real: persiste con PATCH /nodes/[nodeId]', async () => {
    const patch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', patch)
    const node = useCanvasStore.getState().nodes[0]
    patchTaskStatus('ws-1', node, 'in_progress')
    expect(patch).toHaveBeenCalledWith('/api/workspaces/ws-1/nodes/t1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress' }),
    })
  })
})