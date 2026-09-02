import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/lib/db'
import { users, workspaces, nodes, edges, workspaceMembers } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import * as canvasService from '@/lib/canvas-service'

const ownerId = uuidv4()
const attackerId = uuidv4()
const wsAId = uuidv4()
const wsBId = uuidv4()

describe('IDOR - control de acceso workspace', () => {
  beforeAll(async () => {
    await db.insert(users).values({
      id: ownerId,
      email: `owner-${ownerId.slice(0, 8)}@example.com`,
      passwordHash: 'hash',
      displayName: 'Owner',
      emailVerified: true,
    })
    await db.insert(users).values({
      id: attackerId,
      email: `attacker-${attackerId.slice(0, 8)}@example.com`,
      passwordHash: 'hash',
      displayName: 'Attacker',
      emailVerified: true,
    })

    await db.insert(workspaces).values({
      id: wsAId,
      ownerId,
      name: 'Workspace A',
      slug: `ws-a-${wsAId.slice(0, 8)}`,
    })
    await db.insert(workspaces).values({
      id: wsBId,
      ownerId: attackerId,
      name: 'Workspace B',
      slug: `ws-b-${wsBId.slice(0, 8)}`,
    })

    await db.insert(workspaceMembers).values({
      id: uuidv4(),
      workspaceId: wsAId,
      userId: ownerId,
      role: 'owner',
    })
    await db.insert(workspaceMembers).values({
      id: uuidv4(),
      workspaceId: wsBId,
      userId: attackerId,
      role: 'owner',
    })
  })

  beforeEach(async () => {
    await db.delete(edges).where(eq(edges.workspaceId, wsAId))
    await db.delete(nodes).where(eq(nodes.workspaceId, wsAId))
    await db.delete(edges).where(eq(edges.workspaceId, wsBId))
    await db.delete(nodes).where(eq(nodes.workspaceId, wsBId))
  })

  afterAll(async () => {
    await db.delete(edges).where(eq(edges.workspaceId, wsAId))
    await db.delete(nodes).where(eq(nodes.workspaceId, wsAId))
    await db.delete(edges).where(eq(edges.workspaceId, wsBId))
    await db.delete(nodes).where(eq(nodes.workspaceId, wsBId))
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, wsAId))
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, wsBId))
    await db.delete(workspaces).where(eq(workspaces.id, wsAId))
    await db.delete(workspaces).where(eq(workspaces.id, wsBId))
    await db.delete(users).where(eq(users.id, ownerId))
    await db.delete(users).where(eq(users.id, attackerId))
  })

  it('IDOR: attacker no puede listar nodos de wsA', async () => {
    // Owner crea nodo en wsA
    await canvasService.createNode(wsAId, ownerId, { type: 'note', title: 'Secreto owner' })
    await expect(canvasService.listNodes(wsAId, attackerId)).rejects.toThrow()
    try {
      await canvasService.listNodes(wsAId, attackerId)
    } catch (e) {
      expect((e as Error).name).toBe('ForbiddenError')
    }
  })

  it('IDOR: attacker no puede crear nodo en wsA', async () => {
    await expect(
      canvasService.createNode(wsAId, attackerId, { type: 'note', title: 'Hack' })
    ).rejects.toThrow()
    try {
      await canvasService.createNode(wsAId, attackerId, { type: 'note', title: 'Hack' })
    } catch (e) {
      expect((e as Error).name).toBe('ForbiddenError')
    }
    const nodesOwner = await canvasService.listNodes(wsAId, ownerId)
    expect(nodesOwner.length).toBe(0)
  })

  it('IDOR: attacker no puede modificar nodo de wsA (updateNode)', async () => {
    const node = await canvasService.createNode(wsAId, ownerId, { type: 'note', title: 'Original' })
    await expect(
      canvasService.updateNode(wsAId, node.id, attackerId, { title: 'Hacked' })
    ).rejects.toThrow()
    try {
      await canvasService.updateNode(wsAId, node.id, attackerId, { title: 'Hacked' })
    } catch (e) {
      expect((e as Error).name).toBe('ForbiddenError')
    }
    const fetched = await canvasService.getNodeById(wsAId, node.id, ownerId)
    expect(fetched.title).toBe('Original')
  })

  it('IDOR: attacker no puede borrar nodo de wsA (softDeleteNode)', async () => {
    const node = await canvasService.createNode(wsAId, ownerId, { type: 'note', title: 'Borrar?' })
    await expect(canvasService.softDeleteNode(wsAId, node.id, attackerId)).rejects.toThrow()
    try {
      await canvasService.softDeleteNode(wsAId, node.id, attackerId)
    } catch (e) {
      expect((e as Error).name).toBe('ForbiddenError')
    }
    const still = await canvasService.getNodeById(wsAId, node.id, ownerId)
    expect(still).toBeDefined()
  })

  it('IDOR: attacker no puede crear edge entre nodos de wsA', async () => {
    const n1 = await canvasService.createNode(wsAId, ownerId, { type: 'note', title: 'N1' })
    const n2 = await canvasService.createNode(wsAId, ownerId, { type: 'note', title: 'N2' })
    await expect(
      canvasService.createEdge(wsAId, attackerId, { sourceId: n1.id, targetId: n2.id, type: 'related_to' })
    ).rejects.toThrow()
    try {
      await canvasService.createEdge(wsAId, attackerId, { sourceId: n1.id, targetId: n2.id, type: 'related_to' })
    } catch (e) {
      expect((e as Error).name).toBe('ForbiddenError')
    }
  })

  it('IDOR: attacker no puede leer graph de wsA', async () => {
    await canvasService.createNode(wsAId, ownerId, { type: 'note', title: 'Secret' })
    await expect(canvasService.getWorkspaceGraph(wsAId, attackerId)).rejects.toThrow()
    try {
      await canvasService.getWorkspaceGraph(wsAId, attackerId)
    } catch (e) {
      expect((e as Error).name).toBe('ForbiddenError')
    }
  })

  it('RBAC: viewer no puede escribir, member sí puede (assertCanWrite)', async () => {
    const viewerId = uuidv4()
    await db.insert(users).values({
      id: viewerId,
      email: `viewer-${viewerId.slice(0, 8)}@example.com`,
      passwordHash: 'hash',
      displayName: 'Viewer',
      emailVerified: true,
    })
    await db.insert(workspaceMembers).values({
      id: uuidv4(),
      workspaceId: wsAId,
      userId: viewerId,
      role: 'viewer',
    })

    // viewer puede listar
    const list = await canvasService.listNodes(wsAId, viewerId)
    expect(list).toBeDefined()

    // viewer no puede crear
    await expect(canvasService.createNode(wsAId, viewerId, { type: 'note', title: 'Viewer create' })).rejects.toThrow()
    try {
      await canvasService.createNode(wsAId, viewerId, { type: 'note', title: 'Viewer create' })
    } catch (e) {
      expect((e as Error).name).toBe('ForbiddenError')
    }

    // limpiar viewer
    await db.delete(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, wsAId), eq(workspaceMembers.userId, viewerId)))
    await db.delete(users).where(eq(users.id, viewerId))
  })

  it('NotFound: workspace inexistente lanza NotFoundError', async () => {
    await expect(canvasService.listNodes('ws-no-existe', ownerId)).rejects.toThrow()
    try {
      await canvasService.listNodes('ws-no-existe', ownerId)
    } catch (e) {
      expect((e as Error).name).toBe('NotFoundError')
    }
  })
})
