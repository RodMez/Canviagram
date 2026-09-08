import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/lib/db'
import { users, workspaces, workspaceMembers, nodes, edges } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import {
  applyTemplate,
  createNode,
  relayoutWorkspace,
  softDeleteNode,
} from '@/lib/canvas-service'
import { occupiedIndex } from '@/lib/canvas/layout'
import { getTemplateCatalog, getTemplateById } from '@/lib/templates/catalog'

// ============================================================
// Fase 0 — templates de proyecto + layout sin solapes
// ============================================================

const ownerId = uuidv4()
const outsiderId = uuidv4()
const wsId = uuidv4()

async function cleanup() {
  try {
    await db.delete(edges).where(eq(edges.workspaceId, wsId))
    await db.delete(nodes).where(eq(nodes.workspaceId, wsId))
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, wsId))
    await db.delete(workspaces).where(eq(workspaces.id, wsId))
    await db.delete(users).where(eq(users.id, ownerId))
    await db.delete(users).where(eq(users.id, outsiderId))
  } catch {
    // ignore
  }
}

describe('templates de proyecto y layout (Fase 0)', () => {
  beforeAll(async () => {
    await db.insert(users).values({
      id: ownerId,
      email: `tpl-owner-${ownerId.slice(0, 8)}@example.com`,
      passwordHash: 'hash',
      displayName: 'Tpl Owner',
      emailVerified: true,
    })
    await db.insert(users).values({
      id: outsiderId,
      email: `tpl-out-${outsiderId.slice(0, 8)}@example.com`,
      passwordHash: 'hash',
      displayName: 'Tpl Outsider',
      emailVerified: true,
    })
    await db.insert(workspaces).values({
      id: wsId,
      ownerId,
      name: 'Tpl WS',
      slug: `tpl-${wsId.slice(0, 8)}`,
    })
  })

  afterAll(async () => {
    await cleanup()
  })

  // ============================================================
  // Catálogo
  // ============================================================

  describe('catálogo de templates', () => {
    it('tiene 3 templates con edges que referencian nodos válidos', () => {
      const catalog = getTemplateCatalog()
      expect(catalog).toHaveLength(3)
      for (const t of catalog) {
        expect(t.nodes.length).toBeGreaterThanOrEqual(6)
        for (const e of t.edges) {
          expect(e.source).toBeGreaterThanOrEqual(0)
          expect(e.source).toBeLessThan(t.nodes.length)
          expect(e.target).toBeGreaterThanOrEqual(0)
          expect(e.target).toBeLessThan(t.nodes.length)
        }
      }
    })

    it('getTemplateById resuelve y devuelve undefined para id desconocido', () => {
      expect(getTemplateById('software-dev')).toBeDefined()
      expect(getTemplateById('nope')).toBeUndefined()
    })
  })

  // ============================================================
  // applyTemplate
  // ============================================================

  describe('applyTemplate', () => {
    it('aplica un template creando subgrafo con descripciones y edges', async () => {
      const template = getTemplateById('software-dev')!
      const result = await applyTemplate(wsId, ownerId, 'software-dev')

      expect(result.nodes).toHaveLength(template.nodes.length)
      expect(result.edges).toHaveLength(template.edges.length)
      for (const n of result.nodes) {
        expect(n.content).toBeTruthy()
        expect(n.title).toBeTruthy()
      }

      const ids = new Set(result.nodes.map((n) => n.id))
      for (const e of result.edges) {
        expect(ids.has(e.sourceId)).toBe(true)
        expect(ids.has(e.targetId)).toBe(true)
      }
    })

    it('la posición del subgrafo no solapa nodos existentes', async () => {
      await createNode(wsId, ownerId, { type: 'project', title: 'Existente' })

      await applyTemplate(wsId, ownerId, 'marketing-campaign')

      const live = await db
        .select({ positionX: nodes.positionX, positionY: nodes.positionY })
        .from(nodes)
        .where(and(eq(nodes.workspaceId, wsId), isNull(nodes.deletedAt)))
        .all()
      const positions = new Set(live.map((n) => `${n.positionX},${n.positionY}`))
      expect(positions.size).toBe(live.length)
    })

    it('outsider no puede aplicar → ForbiddenError', async () => {
      await expect(applyTemplate(wsId, outsiderId, 'product-launch')).rejects.toThrow()
    })

    it('template desconocido → NotFoundError', async () => {
      await expect(applyTemplate(wsId, ownerId, 'no-existe')).rejects.toThrow()
    })
  })

  // ============================================================
  // createNode sin solapes tras borrados
  // ============================================================

  describe('createNode sin reutilizar slots ocupados', () => {
    it('tras borrar un nodo, el nuevo no pisa los vivos', async () => {
      const a = await createNode(wsId, ownerId, { type: 'task', title: 'col-a' })
      const b = await createNode(wsId, ownerId, { type: 'task', title: 'col-b' })
      const c = await createNode(wsId, ownerId, { type: 'task', title: 'col-c' })

      await softDeleteNode(wsId, b.id, ownerId)

      const d = await createNode(wsId, ownerId, { type: 'task', title: 'col-d' })

      const live = await db
        .select({ positionX: nodes.positionX, positionY: nodes.positionY })
        .from(nodes)
        .where(and(eq(nodes.workspaceId, wsId), isNull(nodes.deletedAt)))
        .all()
      const positions = new Set(live.map((n) => `${n.positionX},${n.positionY}`))
      expect(positions.size).toBe(live.length)

      expect(`${d.positionX},${d.positionY}`).not.toBe(`${c.positionX},${c.positionY}`)
      expect(`${d.positionX},${d.positionY}`).not.toBe(`${a.positionX},${a.positionY}`)
    })
  })

  // ============================================================
  // relayoutWorkspace
  // ============================================================

  describe('relayoutWorkspace', () => {
    it('compacta el grafo en grilla sin solapes', async () => {
      const result = await relayoutWorkspace(wsId, ownerId)

      const live = await db
        .select()
        .from(nodes)
        .where(and(eq(nodes.workspaceId, wsId), isNull(nodes.deletedAt)))
        .all()
      expect(live.length).toBeGreaterThan(0)
      expect(result.repositioned).toBe(live.length)

      const positions = new Set(live.map((n) => `${n.positionX},${n.positionY}`))
      expect(positions.size).toBe(live.length)

      // Observación: los nodos de un mismo template comparten createdAt, así que
      // el "primer" nodo no tiene por qué ser el project; la garantía contractada
      // es la ausencia de solapamientos + grilla bidimensional correcta.
      for (const n of live) {
        expect(Number.isInteger(n.positionX / 320)).toBe(true)
        expect(Number.isInteger(n.positionY / 200)).toBe(true)
      }
    })
  })
})