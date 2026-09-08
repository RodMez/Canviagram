import { describe, it, expect } from 'vitest'
import {
  DEMO_WORKSPACE_ID,
  DEMO_CREATED_AT,
  isDemoWorkspace,
  demoId,
  getDemoFixtures,
  demoGraphToPayload,
} from '@/lib/demo/fixtures'
import { NODE_TYPES, NODE_STATUSES, EDGE_TYPES } from '@/lib/db/schema'

// ============================================================
// F4.1a: validez estructural de los fixtures de la demo
// ============================================================

describe('lib/demo/fixtures', () => {
  describe('constantes y helpers', () => {
    it('DEMO_WORKSPACE_ID es "demo"', () => {
      expect(DEMO_WORKSPACE_ID).toBe('demo')
    })

    it('isDemoWorkspace solo es true para "demo"', () => {
      expect(isDemoWorkspace('demo')).toBe(true)
      expect(isDemoWorkspace('ws-real-uuid')).toBe(false)
      expect(isDemoWorkspace('')).toBe(false)
    })

    it('demoId genera ids con prefijo n-/e- y sufijo de 8 chars', () => {
      const n = demoId('n')
      const e = demoId('e')
      expect(n).toMatch(/^n-[0-9a-f]{8}$/)
      expect(e).toMatch(/^e-[0-9a-f]{8}$/)
      expect(demoId('n')).not.toBe(n)
    })
  })

  describe('getDemoFixtures', () => {
    it('devuelve 8 nodos y 8 edges', () => {
      const { nodes, edges } = getDemoFixtures()
      expect(nodes).toHaveLength(8)
      expect(edges).toHaveLength(8)
    })

    it('devuelve arrays NUEVOS en cada llamada (reseed limpio)', () => {
      const a = getDemoFixtures()
      const b = getDemoFixtures()
      expect(a.nodes).not.toBe(b.nodes)
      expect(a.edges).not.toBe(b.edges)
      expect(a.nodes[0]).not.toBe(b.nodes[0])
    })

    it('ids de nodos y edges son únicos', () => {
      const { nodes, edges } = getDemoFixtures()
      const nodeIds = nodes.map((n) => n.id)
      const edgeIds = edges.map((e) => e.id)
      expect(new Set(nodeIds).size).toBe(nodeIds.length)
      expect(new Set(edgeIds).size).toBe(edgeIds.length)
    })

    it('todos los nodos/edges usan workspaceId demo y createdBy demo', () => {
      const { nodes, edges } = getDemoFixtures()
      for (const n of nodes) {
        expect(n.workspaceId).toBe(DEMO_WORKSPACE_ID)
        expect(n.createdBy).toBe('demo')
        expect(n.deletedAt).toBeNull()
        expect(n.createdAt).toEqual(DEMO_CREATED_AT)
        expect(n.updatedAt).toEqual(DEMO_CREATED_AT)
      }
      for (const e of edges) {
        expect(e.workspaceId).toBe(DEMO_WORKSPACE_ID)
        expect(e.createdBy).toBe('demo')
        expect(e.createdAt).toEqual(DEMO_CREATED_AT)
      }
    })

    it('tipos de nodo y edge son válidos; status solo en tasks', () => {
      const { nodes, edges } = getDemoFixtures()
      for (const n of nodes) {
        expect(NODE_TYPES).toContain(n.type)
        if (n.status !== null) {
          expect(n.type).toBe('task')
          expect(NODE_STATUSES).toContain(n.status)
        }
      }
      for (const e of edges) {
        expect(EDGE_TYPES).toContain(e.type)
      }
    })

    it('cada edge referencia nodos vivos (source y target)', () => {
      const { nodes, edges } = getDemoFixtures()
      const ids = new Set(nodes.map((n) => n.id))
      for (const e of edges) {
        expect(ids.has(e.sourceId)).toBe(true)
        expect(ids.has(e.targetId)).toBe(true)
      }
    })

    it('los 3 tipos de edge están representados', () => {
      const { edges } = getDemoFixtures()
      const types = new Set(edges.map((e) => e.type))
      expect(types.has('parent_of')).toBe(true)
      expect(types.has('depends_on')).toBe(true)
      expect(types.has('related_to')).toBe(true)
    })
  })

  describe('demoGraphToPayload', () => {
    it('serializa nodos/edges al shape del body de chat-demo', () => {
      const { nodes, edges } = getDemoFixtures()
      const payload = demoGraphToPayload({ nodes, edges })
      expect(payload.nodes).toHaveLength(8)
      expect(payload.edges).toHaveLength(8)
      const node = payload.nodes[0]
      expect(node).toEqual({
        id: node.id,
        type: node.type,
        title: node.title,
        content: node.content,
        status: node.status,
        positionX: node.positionX,
        positionY: node.positionY,
        dueDate: null,
        reminderOffsetMin: null,
      })
      expect(node).not.toHaveProperty('workspaceId')
      expect(node).not.toHaveProperty('createdBy')
      const edge = payload.edges[0]
      expect(edge).toEqual({
        id: edge.id,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        type: edge.type,
        label: edge.label,
      })
      expect(edge).not.toHaveProperty('workspaceId')
    })
  })
})