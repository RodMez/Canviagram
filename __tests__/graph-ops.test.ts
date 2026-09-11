import { describe, it, expect, beforeEach } from 'vitest'
import {
  cloneGraph,
  createNode,
  updateNode,
  deleteNode,
  createEdge,
  deleteEdge,
  queryGraph,
  type DemoGraph,
} from '@/lib/demo/graph-ops'
import { getDemoFixtures } from '@/lib/demo/fixtures'
import { ValidationError, NotFoundError } from '@/lib/errors'

// ============================================================
// F4.1b: ops de grafo en memoria de la demo
// ============================================================

function makeGraph(): DemoGraph {
  return cloneGraph(getDemoFixtures())
}

describe('lib/demo/graph-ops', () => {
  let graph: DemoGraph
  beforeEach(() => {
    graph = makeGraph()
  })

  describe('cloneGraph', () => {
    it('devuelve arrays y objetos nuevos (sin referencias compartidas)', () => {
      const copy = cloneGraph(graph)
      expect(copy.nodes).not.toBe(graph.nodes)
      expect(copy.edges).not.toBe(graph.edges)
      expect(copy.nodes[0]).not.toBe(graph.nodes[0])
      copy.nodes[0].title = 'mutado'
      expect(graph.nodes[0].title).not.toBe('mutado')
    })
  })

  describe('createNode', () => {
    it('crea nodo con id demo-* y workspaceId demo', () => {
      const node = createNode(graph, {
        type: 'task',
        title: 'Publicar post',
        status: 'todo',
        positionX: 10,
        positionY: 20,
      })
      expect(node.id).toMatch(/^n-[0-9a-f]{8}$/)
      expect(node.workspaceId).toBe('demo')
      expect(node.createdBy).toBe('demo')
      expect(node.status).toBe('todo')
      expect(graph.nodes).toHaveLength(8)
    })

    it('rechaza status en nodos no-task (misma validación que prod)', () => {
      expect(() =>
        createNode(graph, { type: 'note', title: 'Nota', status: 'done' })
      ).toThrow(ValidationError)
    })

    it('rechaza título vacío', () => {
      expect(() => createNode(graph, { type: 'task', title: '  ' })).toThrow()
    })
  })

  describe('updateNode', () => {
    it('actualiza campos del nodo existente', () => {
      const updated = updateNode(graph, 'demo-task-1', { title: 'Nuevo título', status: 'done' })
      expect(updated.title).toBe('Nuevo título')
      expect(updated.status).toBe('done')
      expect(graph.nodes.find((n) => n.id === 'demo-task-1')?.title).toBe('Nuevo título')
    })

    it('lanza NotFoundError si el nodo no existe', () => {
      expect(() => updateNode(graph, 'n-inexistente', { title: 'X' })).toThrow(NotFoundError)
    })

    it('rechaza status en nodo no-task', () => {
      expect(() => updateNode(graph, 'demo-note-1', { status: 'done' })).toThrow(ValidationError)
    })
  })

  describe('deleteNode', () => {
    it('borra el nodo y cascadea sus edges', () => {
      // F5.1: sin hub demo-proj-1; demo-task-2 concentra 3 edges (4, 5, 7)
      const result = deleteNode(graph, 'demo-task-2')
      expect(result.success).toBe(true)
      expect(result.nodeId).toBe('demo-task-2')
      expect(result.removedEdgeIds).toHaveLength(3)
      expect(result.removedEdgeIds).toEqual(
        expect.arrayContaining(['demo-edge-4', 'demo-edge-5', 'demo-edge-7'])
      )
      expect(graph.nodes.find((n) => n.id === 'demo-task-2')).toBeUndefined()
      expect(graph.edges.some((e) => e.sourceId === 'demo-task-2' || e.targetId === 'demo-task-2')).toBe(false)
    })

    it('lanza NotFoundError si el nodo no existe', () => {
      expect(() => deleteNode(graph, 'n-inexistente')).toThrow(NotFoundError)
    })
  })

  describe('createEdge', () => {
    it('crea edge con id demo-* entre nodos existentes', () => {
      const edge = createEdge(graph, {
        sourceId: 'demo-task-1',
        targetId: 'demo-task-3',
        type: 'depends_on',
        label: 'después',
      })
      expect(edge.id).toMatch(/^e-[0-9a-f]{8}$/)
      expect(edge.workspaceId).toBe('demo')
      expect(edge.label).toBe('después')
      expect(graph.edges).toHaveLength(6)
    })

    it('rechaza self-loop (misma validación que prod)', () => {
      expect(() =>
        createEdge(graph, { sourceId: 'demo-task-1', targetId: 'demo-task-1', type: 'related_to' })
      ).toThrow(ValidationError)
    })

    it('lanza NotFoundError si source o target no existen', () => {
      expect(() =>
        createEdge(graph, { sourceId: 'n-inexistente', targetId: 'demo-task-1', type: 'related_to' })
      ).toThrow(NotFoundError)
    })
  })

  describe('deleteEdge', () => {
    it('borra el edge por id', () => {
      const result = deleteEdge(graph, 'demo-edge-4')
      expect(result).toEqual({ success: true, edgeId: 'demo-edge-4' })
      expect(graph.edges.find((e) => e.id === 'demo-edge-4')).toBeUndefined()
    })

    it('lanza NotFoundError si el edge no existe', () => {
      expect(() => deleteEdge(graph, 'e-inexistente')).toThrow(NotFoundError)
    })
  })

  describe('queryGraph', () => {
    it('retorna el grafo actual', () => {
      const result = queryGraph(graph)
      expect(result.nodes).toHaveLength(7)
      expect(result.edges).toHaveLength(5)
    })
  })
})