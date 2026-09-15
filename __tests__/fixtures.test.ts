import { describe, it, expect } from 'vitest'
import {
  DEMO_WORKSPACE_ID,
  DEMO_CREATED_AT,
  DEMO_ASSIGNEES,
  DEMO_SUGGESTED_PROMPTS,
  isDemoWorkspace,
  demoId,
  getDemoFixtures,
  getDemoBuckets,
  resolveDemoAssigneeName,
  demoGraphToPayload,
} from '@/lib/demo/fixtures'
import { NODE_TYPES, NODE_STATUSES, EDGE_TYPES } from '@/lib/db/schema'

// ============================================================
// F7: validez estructural de los fixtures demo (Café Luna)
// ============================================================

const FORBIDDEN = [
  'Ana',
  'Luis',
  'Valeria',
  'Figma',
  'newsletter',
  'producción',
  'deploy',
  'Next.js',
  'Template',
  'artículo',
]

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

  describe('getDemoFixtures (Café Luna)', () => {
    it('devuelve 12 nodos y 7 edges (sin nodo-hub project)', () => {
      const { nodes, edges } = getDemoFixtures()
      expect(nodes).toHaveLength(12)
      expect(edges).toHaveLength(7)
    })

    it('no contiene nodos de tipo project (F5.1: workspace = proyecto)', () => {
      const { nodes } = getDemoFixtures()
      expect(nodes.some((n) => (n.type as string) === 'project')).toBe(false)
    })

    it('no usa nombres ni temas de la escena ingenieril anterior', () => {
      const { nodes } = getDemoFixtures()
      const haystack = nodes.map((n) => `${n.title} ${n.content ?? ''}`).join('\n')
      for (const word of FORBIDDEN) {
        expect(haystack).not.toContain(word)
      }
    })

    it('responsables demo solo Emma, Liam u Oliver', () => {
      const { nodes } = getDemoFixtures()
      const tasks = nodes.filter((n) => n.type === 'task')
      expect(tasks).toHaveLength(7)
      for (const t of tasks) {
        expect(DEMO_ASSIGNEES[t.id]).toMatch(/^(Emma|Liam|Oliver)$/)
        expect(t.assigneeId).toBe(DEMO_ASSIGNEES[t.id])
      }
    })

    it('resolveDemoAssigneeName solo resuelve personas de la demo', () => {
      expect(resolveDemoAssigneeName('Emma')).toBe('Emma')
      expect(resolveDemoAssigneeName('Oliver')).toBe('Oliver')
      expect(resolveDemoAssigneeName('user-uuid-real')).toBeNull()
      expect(resolveDemoAssigneeName(null)).toBeNull()
      expect(resolveDemoAssigneeName(undefined)).toBeNull()
    })

    it('hay vencida, de hoy y futuras: alimenta los buckets de Hoy', () => {
      const now = new Date('2026-09-15T10:00:00')
      const { nodes } = getDemoFixtures(now)
      const buckets = getDemoBuckets(nodes, now)
      expect(buckets.overdue.map((n) => n.id)).toContain('demo-task-permiso')
      expect(buckets.today.map((n) => n.id)).toEqual(
        expect.arrayContaining(['demo-task-maquina', 'demo-task-menu'])
      )
      expect(buckets.upcoming.length).toBeGreaterThanOrEqual(3)
      expect(buckets.done.map((n) => n.id)).toContain('demo-task-local')
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

    it('depends_on y related_to están representados (sin hub parent_of tras F5.1)', () => {
      const { edges } = getDemoFixtures()
      const types = new Set(edges.map((e) => e.type))
      expect(types.has('depends_on')).toBe(true)
      expect(types.has('related_to')).toBe(true)
    })

    it('la máquina está bloqueada por el permiso (chip del Tablero)', () => {
      const { edges } = getDemoFixtures()
      const block = edges.find(
        (e) => e.sourceId === 'demo-task-maquina' && e.type === 'depends_on'
      )
      expect(block?.targetId).toBe('demo-task-permiso')
    })
  })

  describe('DEMO_SUGGESTED_PROMPTS', () => {
    it('son prompts no vacíos y únicos', () => {
      expect(DEMO_SUGGESTED_PROMPTS.length).toBeGreaterThanOrEqual(3)
      const ids = DEMO_SUGGESTED_PROMPTS.map((p) => p.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const p of DEMO_SUGGESTED_PROMPTS) {
        expect(p.label.length).toBeGreaterThan(0)
        expect(p.prompt.length).toBeGreaterThan(0)
      }
    })
  })

  describe('demoGraphToPayload', () => {
    it('serializa nodos/edges al shape del body de chat-demo', () => {
      const { nodes, edges } = getDemoFixtures()
      const payload = demoGraphToPayload({ nodes, edges })
      expect(payload.nodes).toHaveLength(12)
      expect(payload.edges).toHaveLength(7)
      const node = payload.nodes[0]
      expect(node).toEqual({
        id: node.id,
        type: node.type,
        title: node.title,
        content: node.content,
        status: node.status,
        priority: (node as { priority?: unknown }).priority ?? null,
        effort: (node as { effort?: unknown }).effort ?? null,
        assigneeId: (node as { assigneeId?: unknown }).assigneeId ?? null,
        linkedUserId: (node as { linkedUserId?: unknown }).linkedUserId ?? null,
        boardColumnId: (node as { boardColumnId?: unknown }).boardColumnId ?? null,
        positionX: node.positionX,
        positionY: node.positionY,
        dueDate: node.dueDate,
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
