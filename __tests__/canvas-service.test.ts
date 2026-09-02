import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/lib/db'
import { users, workspaces, nodes, edges } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import * as canvasService from '@/lib/canvas-service'
import * as pubsub from '@/lib/sse/pubsub'

const testUserId = uuidv4()
const testWorkspaceId = uuidv4()
const testUserId2 = uuidv4()

describe('canvas-service', () => {
  beforeAll(async () => {
    // Crear usuario de prueba
    await db.insert(users).values({
      id: testUserId,
      email: `test-${testUserId.slice(0, 8)}@example.com`,
      passwordHash: 'hash',
      displayName: 'Test User',
      emailVerified: true,
    })

    await db.insert(users).values({
      id: testUserId2,
      email: `test2-${testUserId2.slice(0, 8)}@example.com`,
      passwordHash: 'hash',
      displayName: 'Test User 2',
      emailVerified: true,
    })

    await db.insert(workspaces).values({
      id: testWorkspaceId,
      ownerId: testUserId,
      name: 'Test Workspace',
      slug: `test-ws-${testWorkspaceId.slice(0, 8)}`,
    })

    pubsub._clearAll()
  })

  beforeEach(async () => {
    // Limpiar nodos y edges del workspace de prueba
    await db.delete(edges).where(eq(edges.workspaceId, testWorkspaceId))
    await db.delete(nodes).where(eq(nodes.workspaceId, testWorkspaceId))
    pubsub._clearAll()
  })

  afterAll(async () => {
    await db.delete(edges).where(eq(edges.workspaceId, testWorkspaceId))
    await db.delete(nodes).where(eq(nodes.workspaceId, testWorkspaceId))
    await db.delete(workspaces).where(eq(workspaces.id, testWorkspaceId))
    await db.delete(users).where(eq(users.id, testUserId))
    await db.delete(users).where(eq(users.id, testUserId2))
    pubsub._clearAll()
  })

  it('createNode y listNodes - crea y lista correctamente', async () => {
    const node = await canvasService.createNode(testWorkspaceId, testUserId, {
      type: 'project',
      title: 'Proyecto Test',
    })
    expect(node).toBeDefined()
    expect(node.title).toBe('Proyecto Test')
    expect(node.type).toBe('project')

    const list = await canvasService.listNodes(testWorkspaceId)
    expect(list.length).toBe(1)
    expect(list[0].id).toBe(node.id)
  })

  it('softDelete filtra - listNodes excluye borrados', async () => {
    const node = await canvasService.createNode(testWorkspaceId, testUserId, {
      type: 'note',
      title: 'Nota a borrar',
    })

    let list = await canvasService.listNodes(testWorkspaceId)
    expect(list.length).toBe(1)

    await canvasService.softDeleteNode(testWorkspaceId, node.id, testUserId)

    list = await canvasService.listNodes(testWorkspaceId)
    expect(list.length).toBe(0)

    // getNodeById debe lanzar NotFoundError después de soft delete
    await expect(canvasService.getNodeById(testWorkspaceId, node.id)).rejects.toThrow()
    try {
      await canvasService.getNodeById(testWorkspaceId, node.id)
    } catch (e) {
      expect((e as Error).name).toBe('NotFoundError')
    }
  })

  it('softDelete - solo borra si pertenece al workspace', async () => {
    const node = await canvasService.createNode(testWorkspaceId, testUserId, {
      type: 'task',
      title: 'Tarea',
      status: 'todo',
    })

    await expect(canvasService.softDeleteNode('workspace-inexistente', node.id, testUserId)).rejects.toThrow()
  })

  it('getNodeById lanza NotFound si no existe', async () => {
    await expect(canvasService.getNodeById(testWorkspaceId, 'id-inexistente')).rejects.toThrow()
  })

  it('edge self-loop debe fallar en validación', async () => {
    const n1 = await canvasService.createNode(testWorkspaceId, testUserId, {
      type: 'task',
      title: 'Tarea 1',
    })

    await expect(
      canvasService.createEdge(testWorkspaceId, testUserId, {
        sourceId: n1.id,
        targetId: n1.id,
        type: 'related_to',
      })
    ).rejects.toThrow()

    try {
      await canvasService.createEdge(testWorkspaceId, testUserId, {
        sourceId: n1.id,
        targetId: n1.id,
        type: 'related_to',
      })
    } catch (e) {
      expect((e as Error).name).toBe('ValidationError')
      expect((e as Error).message).toMatch(/no puede conectarse a sí mismo/)
    }
  })

  it('createEdge válido y listEdges', async () => {
    const n1 = await canvasService.createNode(testWorkspaceId, testUserId, {
      type: 'project',
      title: 'Proyecto',
    })
    const n2 = await canvasService.createNode(testWorkspaceId, testUserId, {
      type: 'task',
      title: 'Tarea',
    })

    const edge = await canvasService.createEdge(testWorkspaceId, testUserId, {
      sourceId: n1.id,
      targetId: n2.id,
      type: 'depends_on',
      label: 'bloquea',
    })

    expect(edge.sourceId).toBe(n1.id)
    expect(edge.targetId).toBe(n2.id)

    const allEdges = await canvasService.listEdges(testWorkspaceId)
    expect(allEdges.length).toBe(1)
  })

  it('updateEdge self-loop debe fallar', async () => {
    const n1 = await canvasService.createNode(testWorkspaceId, testUserId, {
      type: 'idea',
      title: 'Idea 1',
    })
    const n2 = await canvasService.createNode(testWorkspaceId, testUserId, {
      type: 'idea',
      title: 'Idea 2',
    })

    const edge = await canvasService.createEdge(testWorkspaceId, testUserId, {
      sourceId: n1.id,
      targetId: n2.id,
      type: 'related_to',
    })

    await expect(
      canvasService.updateEdge(testWorkspaceId, edge.id, testUserId, {
        sourceId: n1.id,
        targetId: n1.id,
      })
    ).rejects.toThrow()
  })

  it('deleteEdge elimina correctamente', async () => {
    const n1 = await canvasService.createNode(testWorkspaceId, testUserId, {
      type: 'project',
      title: 'P1',
    })
    const n2 = await canvasService.createNode(testWorkspaceId, testUserId, {
      type: 'project',
      title: 'P2',
    })
    const edge = await canvasService.createEdge(testWorkspaceId, testUserId, {
      sourceId: n1.id,
      targetId: n2.id,
      type: 'related_to',
    })

    await canvasService.deleteEdge(testWorkspaceId, edge.id, testUserId)
    const list = await canvasService.listEdges(testWorkspaceId)
    expect(list.length).toBe(0)
  })

  it('publish - createNode dispara evento via pubsub', async () => {
    const chunks: Uint8Array[] = []
    const fakeController = {
      enqueue: (chunk: Uint8Array) => chunks.push(chunk),
    } as unknown as ReadableStreamDefaultController<Uint8Array>

    pubsub.subscribe(testWorkspaceId, fakeController)
    expect(pubsub._size()).toBe(1)
    expect(pubsub._sizeByWorkspace(testWorkspaceId)).toBe(1)

    const node = await canvasService.createNode(testWorkspaceId, testUserId, {
      type: 'note',
      title: 'Nota publish',
    })

    expect(chunks.length).toBe(1)
    const decoded = new TextDecoder().decode(chunks[0])
    expect(decoded).toContain('event: node:created')
    expect(decoded).toContain(node.id)

    pubsub.unsubscribe(testWorkspaceId, fakeController)
    expect(pubsub._size()).toBe(0)

    // Otro nodo no debe llegar al controlador desuscrito
    const before = chunks.length
    await canvasService.createNode(testWorkspaceId, testUserId, {
      type: 'note',
      title: 'Otra nota',
    })
    expect(chunks.length).toBe(before)
  })

  it('getWorkspaceGraph retorna nodos y edges filtrados', async () => {
    const n1 = await canvasService.createNode(testWorkspaceId, testUserId, {
      type: 'project',
      title: 'Proj',
    })
    const n2 = await canvasService.createNode(testWorkspaceId, testUserId, {
      type: 'task',
      title: 'Task',
    })
    await canvasService.createEdge(testWorkspaceId, testUserId, {
      sourceId: n1.id,
      targetId: n2.id,
      type: 'related_to',
    })

    // Borrar un nodo y verificar que no aparece en graph
    const n3 = await canvasService.createNode(testWorkspaceId, testUserId, {
      type: 'note',
      title: 'Borrar',
    })
    await canvasService.softDeleteNode(testWorkspaceId, n3.id, testUserId)

    const graph = await canvasService.getWorkspaceGraph(testWorkspaceId)
    expect(graph.nodes.length).toBe(2)
    expect(graph.edges.length).toBe(1)
    expect(graph.nodes.find((n) => n.id === n3.id)).toBeUndefined()
  })

  it('updateNode - status solo si task', async () => {
    const note = await canvasService.createNode(testWorkspaceId, testUserId, {
      type: 'note',
      title: 'Nota sin status',
    })

    await expect(
      canvasService.updateNode(testWorkspaceId, note.id, testUserId, {
        status: 'todo',
      })
    ).rejects.toThrow()

    const task = await canvasService.createNode(testWorkspaceId, testUserId, {
      type: 'task',
      title: 'Tarea con status',
      status: 'todo',
    })

    const updated = await canvasService.updateNode(testWorkspaceId, task.id, testUserId, {
      status: 'done',
      title: 'Tarea actualizada',
    })
    expect(updated.status).toBe('done')
    expect(updated.title).toBe('Tarea actualizada')
  })
})
