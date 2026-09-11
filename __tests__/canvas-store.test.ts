import { describe, it, expect, beforeEach } from 'vitest'
import { useCanvasStore, selectNodes, selectEdges, selectSelectedNode } from '@/store/canvas-store'
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
// Tests
// ============================================================

describe('canvas-store', () => {
  beforeEach(() => {
    useCanvasStore.setState({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      isPanelCollapsed: false,
      demoMode: false,
    })
  })

  describe('setNodes / setEdges / loadGraph', () => {
    it('setNodes reemplaza nodos', () => {
      const nodes = [makeNode({ id: 'n1' }), makeNode({ id: 'n2' })]
      useCanvasStore.getState().setNodes(nodes)
      expect(useCanvasStore.getState().nodes).toHaveLength(2)
      expect(useCanvasStore.getState().nodes[0].id).toBe('n1')
    })

    it('setEdges reemplaza edges', () => {
      const edges = [makeEdge({ id: 'e1' })]
      useCanvasStore.getState().setEdges(edges)
      expect(useCanvasStore.getState().edges).toHaveLength(1)
    })

    it('loadGraph establece nodos y edges juntos', () => {
      const nodes = [makeNode({ id: 'n1' })]
      const edges = [makeEdge({ id: 'e1', sourceId: 'n1', targetId: 'n1' })]
      useCanvasStore.getState().loadGraph(nodes, edges)
      expect(useCanvasStore.getState().nodes).toHaveLength(1)
      expect(useCanvasStore.getState().edges).toHaveLength(1)
    })
  })

  describe('applyEvent — node:created', () => {
    it('agrega nodo nuevo', () => {
      const node = makeNode({ id: 'n1' })
      useCanvasStore.getState().applyEvent({ event: 'node:created', data: node })
      expect(useCanvasStore.getState().nodes).toHaveLength(1)
      expect(useCanvasStore.getState().nodes[0].id).toBe('n1')
    })

    it('es idempotente: no duplica nodo existente', () => {
      const node = makeNode({ id: 'n1' })
      useCanvasStore.getState().applyEvent({ event: 'node:created', data: node })
      useCanvasStore.getState().applyEvent({ event: 'node:created', data: node })
      expect(useCanvasStore.getState().nodes).toHaveLength(1)
    })

    it('agrega múltiples nodos diferentes', () => {
      useCanvasStore.getState().applyEvent({ event: 'node:created', data: makeNode({ id: 'n1' }) })
      useCanvasStore.getState().applyEvent({ event: 'node:created', data: makeNode({ id: 'n2' }) })
      expect(useCanvasStore.getState().nodes).toHaveLength(2)
    })
  })

  describe('applyEvent — node:updated', () => {
    it('actualiza campos del nodo existente', () => {
      useCanvasStore.setState({ nodes: [makeNode({ id: 'n1', title: 'Old' })] })
      useCanvasStore.getState().applyEvent({
        event: 'node:updated',
        data: makeNode({ id: 'n1', title: 'New' }),
      })
      expect(useCanvasStore.getState().nodes[0].title).toBe('New')
    })

    it('no agrega nodo nuevo si id no existe', () => {
      useCanvasStore.setState({ nodes: [makeNode({ id: 'n1' })] })
      useCanvasStore.getState().applyEvent({
        event: 'node:updated',
        data: makeNode({ id: 'n999', title: 'Ghost' }),
      })
      expect(useCanvasStore.getState().nodes).toHaveLength(1)
    })
  })

  describe('applyEvent — node:deleted', () => {
    it('borra nodo por id', () => {
      useCanvasStore.setState({
        nodes: [makeNode({ id: 'n1' }), makeNode({ id: 'n2' })],
        edges: [],
      })
      useCanvasStore.getState().applyEvent({
        event: 'node:deleted',
        data: { id: 'n1', workspaceId: 'ws-1' },
      })
      expect(useCanvasStore.getState().nodes).toHaveLength(1)
      expect(useCanvasStore.getState().nodes[0].id).toBe('n2')
    })

    it('borra edges relacionados (sourceId o targetId)', () => {
      useCanvasStore.setState({
        nodes: [makeNode({ id: 'n1' }), makeNode({ id: 'n2' }), makeNode({ id: 'n3' })],
        edges: [
          makeEdge({ id: 'e1', sourceId: 'n1', targetId: 'n2' }),
          makeEdge({ id: 'e2', sourceId: 'n2', targetId: 'n3' }),
          makeEdge({ id: 'e3', sourceId: 'n3', targetId: 'n1' }),
        ],
      })
      useCanvasStore.getState().applyEvent({
        event: 'node:deleted',
        data: { id: 'n1', workspaceId: 'ws-1' },
      })
      // e1 (sourceId=n1) y e3 (targetId=n1) eliminados; e2 queda
      expect(useCanvasStore.getState().edges).toHaveLength(1)
      expect(useCanvasStore.getState().edges[0].id).toBe('e2')
    })

    it('deselecciona si el nodo borrado estaba seleccionado', () => {
      useCanvasStore.setState({
        nodes: [makeNode({ id: 'n1' })],
        edges: [],
        selectedNodeId: 'n1',
      })
      useCanvasStore.getState().applyEvent({
        event: 'node:deleted',
        data: { id: 'n1', workspaceId: 'ws-1' },
      })
      expect(useCanvasStore.getState().selectedNodeId).toBeNull()
    })

    it('no deselecciona si otro nodo estaba seleccionado', () => {
      useCanvasStore.setState({
        nodes: [makeNode({ id: 'n1' }), makeNode({ id: 'n2' })],
        edges: [],
        selectedNodeId: 'n2',
      })
      useCanvasStore.getState().applyEvent({
        event: 'node:deleted',
        data: { id: 'n1', workspaceId: 'ws-1' },
      })
      expect(useCanvasStore.getState().selectedNodeId).toBe('n2')
    })
  })

  describe('applyEvent — edge:created', () => {
    it('agrega edge nuevo', () => {
      const edge = makeEdge({ id: 'e1' })
      useCanvasStore.getState().applyEvent({ event: 'edge:created', data: edge })
      expect(useCanvasStore.getState().edges).toHaveLength(1)
      expect(useCanvasStore.getState().edges[0].id).toBe('e1')
    })

    it('es idempotente: no duplica edge existente', () => {
      const edge = makeEdge({ id: 'e1' })
      useCanvasStore.getState().applyEvent({ event: 'edge:created', data: edge })
      useCanvasStore.getState().applyEvent({ event: 'edge:created', data: edge })
      expect(useCanvasStore.getState().edges).toHaveLength(1)
    })
  })

  describe('applyEvent — edge:updated', () => {
    it('actualiza campos del edge existente', () => {
      useCanvasStore.setState({ edges: [makeEdge({ id: 'e1', label: 'Old' })] })
      useCanvasStore.getState().applyEvent({
        event: 'edge:updated',
        data: makeEdge({ id: 'e1', label: 'New' }),
      })
      expect(useCanvasStore.getState().edges[0].label).toBe('New')
    })
  })

  describe('applyEvent — edge:deleted', () => {
    it('borra edge por id', () => {
      useCanvasStore.setState({
        edges: [makeEdge({ id: 'e1' }), makeEdge({ id: 'e2' })],
      })
      useCanvasStore.getState().applyEvent({
        event: 'edge:deleted',
        data: { id: 'e1', workspaceId: 'ws-1' },
      })
      expect(useCanvasStore.getState().edges).toHaveLength(1)
      expect(useCanvasStore.getState().edges[0].id).toBe('e2')
    })
  })

  describe('demoMode', () => {
    it('ignora eventos del servidor cuando demoMode está activo', () => {
      useCanvasStore.getState().setDemoMode(true)
      useCanvasStore.getState().applyEvent({
        event: 'node:created',
        data: makeNode({ id: 'n1' }),
      })
      expect(useCanvasStore.getState().nodes).toHaveLength(0)
    })

    it('permite eventos cuando demoMode está desactivado', () => {
      useCanvasStore.getState().setDemoMode(false)
      useCanvasStore.getState().applyEvent({
        event: 'node:created',
        data: makeNode({ id: 'n1' }),
      })
      expect(useCanvasStore.getState().nodes).toHaveLength(1)
    })
  })

  describe('applyLocalEvent (demo bus, F4.1)', () => {
    it('aplica node:created aunque demoMode esté activo (sin guard)', () => {
      useCanvasStore.getState().setDemoMode(true)
      useCanvasStore.getState().applyLocalEvent({
        event: 'node:created',
        data: makeNode({ id: 'n1' }),
      })
      expect(useCanvasStore.getState().nodes).toHaveLength(1)
    })

    it('es idempotente por id igual que applyEvent', () => {
      useCanvasStore.getState().applyLocalEvent({
        event: 'node:created',
        data: makeNode({ id: 'n1' }),
      })
      useCanvasStore.getState().applyLocalEvent({
        event: 'node:created',
        data: makeNode({ id: 'n1' }),
      })
      expect(useCanvasStore.getState().nodes).toHaveLength(1)
    })

    it('cascadea edges al borrar un nodo (node:deleted)', () => {
      useCanvasStore.setState({
        nodes: [makeNode({ id: 'n1' }), makeNode({ id: 'n2' })],
        edges: [
          makeEdge({ id: 'e1', sourceId: 'n1', targetId: 'n2' }),
          makeEdge({ id: 'e2', sourceId: 'n2', targetId: 'n1' }),
        ],
      })
      useCanvasStore.getState().applyLocalEvent({
        event: 'node:deleted',
        data: { id: 'n1', workspaceId: 'demo' },
      })
      expect(useCanvasStore.getState().nodes).toHaveLength(1)
      expect(useCanvasStore.getState().edges).toHaveLength(0)
    })

    it('aplica edge:created/updated/deleted locales', () => {
      useCanvasStore.getState().applyLocalEvent({
        event: 'edge:created',
        data: makeEdge({ id: 'e1', label: 'Old' }),
      })
      useCanvasStore.getState().applyLocalEvent({
        event: 'edge:updated',
        data: makeEdge({ id: 'e1', label: 'New' }),
      })
      expect(useCanvasStore.getState().edges[0].label).toBe('New')
      useCanvasStore.getState().applyLocalEvent({
        event: 'edge:deleted',
        data: { id: 'e1', workspaceId: 'demo' },
      })
      expect(useCanvasStore.getState().edges).toHaveLength(0)
    })

    it('deselecciona el nodo borrado', () => {
      useCanvasStore.setState({
        nodes: [makeNode({ id: 'n1' })],
        edges: [],
        selectedNodeId: 'n1',
      })
      useCanvasStore.getState().applyLocalEvent({
        event: 'node:deleted',
        data: { id: 'n1', workspaceId: 'demo' },
      })
      expect(useCanvasStore.getState().selectedNodeId).toBeNull()
    })
  })

  describe('selectNode', () => {
    it('selecciona un nodo', () => {
      useCanvasStore.getState().selectNode('n1')
      expect(useCanvasStore.getState().selectedNodeId).toBe('n1')
    })

    it('deselecciona con null', () => {
      useCanvasStore.setState({ selectedNodeId: 'n1' })
      useCanvasStore.getState().selectNode(null)
      expect(useCanvasStore.getState().selectedNodeId).toBeNull()
    })
  })

  describe('togglePanel', () => {
    it('alterna isPanelCollapsed', () => {
      expect(useCanvasStore.getState().isPanelCollapsed).toBe(false)
      useCanvasStore.getState().togglePanel()
      expect(useCanvasStore.getState().isPanelCollapsed).toBe(true)
      useCanvasStore.getState().togglePanel()
      expect(useCanvasStore.getState().isPanelCollapsed).toBe(false)
    })
  })

  describe('selectors', () => {
    it('selectNodes retorna nodos', () => {
      const nodes = [makeNode({ id: 'n1' })]
      useCanvasStore.setState({ nodes })
      expect(selectNodes(useCanvasStore.getState())).toBe(nodes)
    })

    it('selectEdges retorna edges', () => {
      const edges = [makeEdge({ id: 'e1' })]
      useCanvasStore.setState({ edges })
      expect(selectEdges(useCanvasStore.getState())).toBe(edges)
    })

    it('selectSelectedNode retorna nodo seleccionado o null', () => {
      const n1 = makeNode({ id: 'n1' })
      const n2 = makeNode({ id: 'n2' })
      useCanvasStore.setState({ nodes: [n1, n2], selectedNodeId: 'n2' })
      expect(selectSelectedNode(useCanvasStore.getState())).toBe(n2)
    })

    it('selectSelectedNode retorna null si nada seleccionado', () => {
      expect(selectSelectedNode(useCanvasStore.getState())).toBeNull()
    })

    it('selectSelectedNode retorna null si selectedNodeId no existe en nodes', () => {
      useCanvasStore.setState({ nodes: [makeNode({ id: 'n1' })], selectedNodeId: 'n999' })
      expect(selectSelectedNode(useCanvasStore.getState())).toBeNull()
    })
  })
})