import { describe, it, expect, beforeEach } from 'vitest'
import { storeToRfNodes, storeToRfEdges, filterOrphanEdges } from '@/lib/canvas/rf'
import { useCanvasStore } from '@/store/canvas-store'
import { MarkerType } from '@xyflow/react'
import type { Node, Edge } from '@/lib/db/schema'

// ============================================================
// Mock data builders
// ============================================================

function makeNode(overrides: Partial<Node> = {}): Node {
  return {
    id: 'n1',
    workspaceId: 'ws-1',
    createdBy: 'user-1',
    type: 'task',
    title: 'Test Node',
    content: null,
    status: 'todo',
    positionX: 100,
    positionY: 200,
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

const WORKSPACE_ID = 'ws-1'

// ============================================================
// Tests
// ============================================================

describe('rf.ts — storeToRfNodes', () => {
  it('mapea id, type, position y data.domain', () => {
    const node = makeNode({ id: 'n1', type: 'task', positionX: 10, positionY: 20 })
    const [rf] = storeToRfNodes([node], WORKSPACE_ID)

    expect(rf.id).toBe('n1')
    expect(rf.type).toBe('task')
    expect(rf.position).toEqual({ x: 10, y: 20 })
    expect(rf.data.domain).toBe(node)
    expect(rf.data.workspaceId).toBe(WORKSPACE_ID)
    expect(rf.selected).toBe(false)
  })

  it('convierte múltiples nodos', () => {
    const nodes = [
      makeNode({ id: 'n1', type: 'project', positionX: 0, positionY: 0 }),
      makeNode({ id: 'n2', type: 'note', positionX: 50, positionY: 50 }),
    ]
    const rfNodes = storeToRfNodes(nodes, WORKSPACE_ID)
    expect(rfNodes).toHaveLength(2)
    expect(rfNodes[0].type).toBe('project')
    expect(rfNodes[1].type).toBe('note')
  })

  it('retorna array vacío si no hay nodos', () => {
    expect(storeToRfNodes([], WORKSPACE_ID)).toEqual([])
  })
})

describe('rf.ts — storeToRfEdges', () => {
  it('mapea source, target, label, data.domain y markerEnd', () => {
    const edge = makeEdge({
      id: 'e1',
      sourceId: 'n1',
      targetId: 'n2',
      type: 'related_to',
      label: 'relacion',
    })
    const [rf] = storeToRfEdges([edge], WORKSPACE_ID)

    expect(rf.id).toBe('e1')
    expect(rf.source).toBe('n1')
    expect(rf.target).toBe('n2')
    expect(rf.label).toBe('relacion')
    expect(rf.data!.domain).toBe(edge)
    expect(rf.data!.workspaceId).toBe(WORKSPACE_ID)
    expect(rf.markerEnd).toEqual({ type: MarkerType.ArrowClosed })
  })

  it('related_to usa tipo RF default; otros usan custom', () => {
    const related = makeEdge({ id: 'e1', type: 'related_to' })
    const depends = makeEdge({ id: 'e2', type: 'depends_on' })
    const parent = makeEdge({ id: 'e3', type: 'parent_of' })
    const rfEdges = storeToRfEdges([related, depends, parent], WORKSPACE_ID)

    expect(rfEdges[0].type).toBe('related_to')
    expect(rfEdges[1].type).toBe('custom')
    expect(rfEdges[2].type).toBe('custom')
  })

  it('label null se convierte a undefined', () => {
    const edge = makeEdge({ id: 'e1', label: null })
    const [rf] = storeToRfEdges([edge], WORKSPACE_ID)
    expect(rf.label).toBeUndefined()
  })
})

describe('rf.ts — filterOrphanEdges', () => {
  it('filtra edges cuyos source/target no están en nodos', () => {
    const nodes = [makeNode({ id: 'n1' }), makeNode({ id: 'n2' })]
    const edges = [
      makeEdge({ id: 'e1', sourceId: 'n1', targetId: 'n2' }), // válidos
      makeEdge({ id: 'e2', sourceId: 'n1', targetId: 'n99' }), // target huérfano
      makeEdge({ id: 'e3', sourceId: 'n99', targetId: 'n2' }), // source huérfano
    ]
    const filtered = filterOrphanEdges(edges, nodes)
    expect(filtered).toHaveLength(1)
    expect(filtered[0].id).toBe('e1')
  })

  it('retorna todos si todos los ids existen', () => {
    const nodes = [makeNode({ id: 'n1' }), makeNode({ id: 'n2' })]
    const edges = [makeEdge({ id: 'e1', sourceId: 'n1', targetId: 'n2' })]
    expect(filterOrphanEdges(edges, nodes)).toHaveLength(1)
  })

  it('retorna array vacío si no hay nodos', () => {
    const edges = [makeEdge({ id: 'e1', sourceId: 'n1', targetId: 'n2' })]
    expect(filterOrphanEdges(edges, [])).toEqual([])
  })
})

describe('rf.ts — integración con store', () => {
  beforeEach(() => {
    useCanvasStore.setState({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      isPanelCollapsed: false,
      demoMode: false,
    })
  })

  it('tras applyEvent(node:created) el store, storeToRfNodes refleja el nuevo nodo', () => {
    const storeNodes = useCanvasStore.getState().nodes
    const before = storeToRfNodes(storeNodes, WORKSPACE_ID)
    expect(before).toHaveLength(0)

    const newNode = makeNode({ id: 'n-new', type: 'idea' })
    useCanvasStore.getState().applyEvent({ event: 'node:created', data: newNode })

    const after = storeToRfNodes(useCanvasStore.getState().nodes, WORKSPACE_ID)
    expect(after).toHaveLength(1)
    expect(after[0].id).toBe('n-new')
    expect(after[0].type).toBe('idea')
    expect(after[0].data.domain).toBe(newNode)
  })
})