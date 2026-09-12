import { describe, it, expect, beforeEach } from 'vitest'
import { getDueDateMs } from '@/components/canvas/NodeDetailPanel'
import { useCanvasStore } from '@/store/canvas-store'
import type { Node, Edge } from '@/lib/db/schema'

// ============================================================
// Fix crash `dueDate.getTime is not a function` (/w/[slug])
// dueDate llega como string ISO por JSON (fetch + SSE) aunque el
// type Drizzle diga Date|null.
// ============================================================

const DUE_ISO = '2026-09-12T10:00:00.000Z'
const DUE_MS = new Date(DUE_ISO).getTime()

function makeNode(overrides: Partial<Node> = {}): Node {
  return {
    id: 'n1',
    workspaceId: 'ws-1',
    createdBy: 'user-1',
    type: 'task',
    title: 'Test Node',
    content: null,
    status: 'todo',
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

/** Simula el round-trip JSON de fetch/SSE: Date -> string ISO. */
function viaJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

describe('getDueDateMs', () => {
  it('acepta Date real', () => {
    expect(getDueDateMs(new Date(DUE_ISO))).toBe(DUE_MS)
  })

  it('acepta string ISO (fetch viejo / SSE) sin lanzar', () => {
    expect(getDueDateMs(DUE_ISO)).toBe(DUE_MS)
  })

  it('acepta epoch ms', () => {
    expect(getDueDateMs(DUE_MS)).toBe(DUE_MS)
  })

  it('null y undefined siguen en null', () => {
    expect(getDueDateMs(null)).toBeNull()
    expect(getDueDateMs(undefined)).toBeNull()
  })

  it('string inválido -> null sin throw', () => {
    expect(getDueDateMs('no-es-fecha')).toBeNull()
    expect(getDueDateMs('')).toBeNull()
  })

  it('Date inválido y tipos inesperados -> null sin throw', () => {
    expect(getDueDateMs(new Date('xyz'))).toBeNull()
    expect(getDueDateMs({})).toBeNull()
    expect(getDueDateMs(Number.NaN)).toBeNull()
  })
})

describe('normalización de fechas en el store (fetch + SSE)', () => {
  beforeEach(() => {
    useCanvasStore.setState({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      isPanelCollapsed: false,
      demoMode: false,
    })
  })

  it('loadGraph normaliza string ISO a Date (flujo fetch)', () => {
    const node = viaJson(makeNode({ dueDate: new Date(DUE_ISO) }))
    // Precondición: tras JSON, dueDate es string (reproduce el bug).
    expect(typeof node.dueDate).toBe('string')
    useCanvasStore.getState().loadGraph([node], [makeEdge()])
    const stored = useCanvasStore.getState().nodes[0]
    expect(stored.dueDate).toBeInstanceOf(Date)
    // El escenario del crash: el panel ya no rompe.
    expect(() => getDueDateMs(stored.dueDate)).not.toThrow()
    expect(getDueDateMs(stored.dueDate)).toBe(DUE_MS)
  })

  it('loadGraph conserva null y Date real', () => {
    useCanvasStore.getState().loadGraph(
      [makeNode({ id: 'a', dueDate: null }), makeNode({ id: 'b', dueDate: new Date(DUE_ISO) })],
      []
    )
    const [a, b] = useCanvasStore.getState().nodes
    expect(a.dueDate).toBeNull()
    expect(b.dueDate).toBeInstanceOf(Date)
    expect(getDueDateMs(b.dueDate)).toBe(DUE_MS)
  })

  it('applyEvent node:created normaliza string ISO (flujo SSE)', () => {
    const node = viaJson(makeNode({ id: 'n1', dueDate: new Date(DUE_ISO) }))
    useCanvasStore.getState().applyEvent({ event: 'node:created', data: node })
    const stored = useCanvasStore.getState().nodes[0]
    expect(stored.dueDate).toBeInstanceOf(Date)
    expect(getDueDateMs(stored.dueDate)).toBe(DUE_MS)
  })

  it('applyEvent node:updated normaliza string ISO y respeta null', () => {
    useCanvasStore.setState({ nodes: [makeNode({ id: 'n1', dueDate: new Date(DUE_ISO) })] })
    const updated = viaJson(makeNode({ id: 'n1', dueDate: new Date('2026-10-01T00:00:00.000Z') }))
    useCanvasStore.getState().applyEvent({ event: 'node:updated', data: updated })
    expect(useCanvasStore.getState().nodes[0].dueDate).toBeInstanceOf(Date)

    const cleared = viaJson(makeNode({ id: 'n1', dueDate: null }))
    useCanvasStore.getState().applyEvent({ event: 'node:updated', data: cleared })
    expect(useCanvasStore.getState().nodes[0].dueDate).toBeNull()
  })

  it('string inválido por SSE -> null sin throw', () => {
    const node = { ...makeNode({ id: 'n1' }), dueDate: 'basura' }
    expect(() =>
      useCanvasStore.getState().applyEvent({ event: 'node:created', data: node })
    ).not.toThrow()
    expect(useCanvasStore.getState().nodes[0].dueDate).toBeNull()
  })

  it('preserva identidad referencial si las fechas ya son Date (sin re-renders espurios)', () => {
    const node = makeNode({ id: 'n1', dueDate: new Date(DUE_ISO) })
    useCanvasStore.getState().applyEvent({ event: 'node:created', data: node })
    expect(useCanvasStore.getState().nodes[0]).toBe(node)
  })
})
