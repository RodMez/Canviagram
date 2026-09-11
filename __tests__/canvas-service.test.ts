import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/lib/db'
import { users, workspaces, nodes, edges, workspaceMembers } from '@/lib/db/schema'
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

    // Membership para owner (aunque owner ya tiene acceso, añadimos por consistencia)
    await db.insert(workspaceMembers).values({
      id: uuidv4(),
      workspaceId: testWorkspaceId,
      userId: testUserId,
      role: 'owner',
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
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, testWorkspaceId))
    await db.delete(workspaces).where(eq(workspaces.id, testWorkspaceId))
    await db.delete(users).where(eq(users.id, testUserId))
    await db.delete(users).where(eq(users.id, testUserId2))
    pubsub._clearAll()
  })

  it('createNode y listNodes - crea y lista correctamente', async () => {
    const node = await canvasService.createNode(testWorkspaceId, testUserId, {
      type: 'task',
      title: 'Tarea Test',
    })
    expect(node).toBeDefined()
    expect(node.title).toBe('Tarea Test')
    expect(node.type).toBe('task')

    const list = await canvasService.listNodes(testWorkspaceId, testUserId)
    expect(list.length).toBe(1)
    expect(list[0].id).toBe(node.id)
  })

  it('listNodes con limit/offset - paginación', async () => {
    for (let i = 0; i < 5; i++) {
      await canvasService.createNode(testWorkspaceId, testUserId, {
        type: 'note',
        title: `Nota ${i}`,
      })
    }
    const first2 = await canvasService.listNodes(testWorkspaceId, testUserId, { limit: 2, offset: 0 })
    expect(first2.length).toBe(2)
    const next2 = await canvasService.listNodes(testWorkspaceId, testUserId, { limit: 2, offset: 2 })
    expect(next2.length).toBe(2)
    // limit se clamp a 100 max, default 50
    const defaultLimit = await canvasService.listNodes(testWorkspaceId, testUserId)
    expect(defaultLimit.length).toBe(5)
  })

  it('softDelete filtra - listNodes excluye borrados', async () => {
    const node = await canvasService.createNode(testWorkspaceId, testUserId, {
      type: 'note',
      title: 'Nota a borrar',
    })

    let list = await canvasService.listNodes(testWorkspaceId, testUserId)
    expect(list.length).toBe(1)

    await canvasService.softDeleteNode(testWorkspaceId, node.id, testUserId)

    list = await canvasService.listNodes(testWorkspaceId, testUserId)
    expect(list.length).toBe(0)

    // getNodeById debe lanzar NotFoundError después de soft delete
    await expect(canvasService.getNodeById(testWorkspaceId, node.id, testUserId)).rejects.toThrow()
    try {
      await canvasService.getNodeById(testWorkspaceId, node.id, testUserId)
    } catch (e) {
      expect((e as Error).name).toBe('NotFoundError')
    }
  })

  it('softDelete - borra edges huérfanos transaccionalmente', async () => {
    const n1 = await canvasService.createNode(testWorkspaceId, testUserId, {
      type: 'task',
      title: 'N1',
    })
    const n2 = await canvasService.createNode(testWorkspaceId, testUserId, {
      type: 'task',
      title: 'N2',
    })
    const edge = await canvasService.createEdge(testWorkspaceId, testUserId, {
      sourceId: n1.id,
      targetId: n2.id,
      type: 'related_to',
    })
    expect(edge).toBeDefined()

    let edgesList = await canvasService.listEdges(testWorkspaceId, testUserId)
    expect(edgesList.length).toBe(1)

    await canvasService.softDeleteNode(testWorkspaceId, n1.id, testUserId)

    edgesList = await canvasService.listEdges(testWorkspaceId, testUserId)
    // El edge donde source == n1.id debe haber sido borrado por la transacción
    expect(edgesList.length).toBe(0)
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
    await expect(canvasService.getNodeById(testWorkspaceId, 'id-inexistente', testUserId)).rejects.toThrow()
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
      type: 'note',
      title: 'Nota origen',
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

    const allEdges = await canvasService.listEdges(testWorkspaceId, testUserId)
    expect(allEdges.length).toBe(1)
  })

  it('createEdge valida source/target dentro de transacción - nodos no existen', async () => {
    await expect(
      canvasService.createEdge(testWorkspaceId, testUserId, {
        sourceId: 'id-falso-source',
        targetId: 'id-falso-target',
        type: 'related_to',
      })
    ).rejects.toThrow()
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
      type: 'note',
      title: 'N1',
    })
    const n2 = await canvasService.createNode(testWorkspaceId, testUserId, {
      type: 'note',
      title: 'N2',
    })
    const edge = await canvasService.createEdge(testWorkspaceId, testUserId, {
      sourceId: n1.id,
      targetId: n2.id,
      type: 'related_to',
    })

    await canvasService.deleteEdge(testWorkspaceId, edge.id, testUserId)
    const list = await canvasService.listEdges(testWorkspaceId, testUserId)
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

  it('getWorkspaceGraph retorna nodos y edges filtrados - edges huérfanos no retornados', async () => {
    const n1 = await canvasService.createNode(testWorkspaceId, testUserId, {
      type: 'note',
      title: 'Nota base',
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

    // Borrar un nodo y verificar que no aparece en graph y su edge tampoco
    const n3 = await canvasService.createNode(testWorkspaceId, testUserId, {
      type: 'note',
      title: 'Borrar',
    })
    // Crear edge entre n3 y n1, luego borrar n3 -> edge debe filtrarse
    await canvasService.createEdge(testWorkspaceId, testUserId, {
      sourceId: n3.id,
      targetId: n1.id,
      type: 'related_to',
    })

    await canvasService.softDeleteNode(testWorkspaceId, n3.id, testUserId)

    const graph = await canvasService.getWorkspaceGraph(testWorkspaceId, testUserId)
    expect(graph.nodes.length).toBe(2)
    expect(graph.edges.length).toBe(1)
    expect(graph.nodes.find((n) => n.id === n3.id)).toBeUndefined()
    expect(graph.edges.find((e) => e.sourceId === n3.id || e.targetId === n3.id)).toBeUndefined()
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

  it('relayoutWorkspace - cadena con depends_on queda ordenada arriba→abajo (dagre)', async () => {
    const a = await canvasService.createNode(testWorkspaceId, testUserId, {
      type: 'task',
      title: 'A',
    })
    const b = await canvasService.createNode(testWorkspaceId, testUserId, {
      type: 'task',
      title: 'B',
    })
    const c = await canvasService.createNode(testWorkspaceId, testUserId, {
      type: 'task',
      title: 'C',
    })
    await canvasService.createEdge(testWorkspaceId, testUserId, {
      sourceId: a.id,
      targetId: b.id,
      type: 'depends_on',
    })
    await canvasService.createEdge(testWorkspaceId, testUserId, {
      sourceId: b.id,
      targetId: c.id,
      type: 'depends_on',
    })

    const result = await canvasService.relayoutWorkspace(testWorkspaceId, testUserId)
    expect(result.repositioned).toBe(3)

    const byId = new Map(
      (await canvasService.listNodes(testWorkspaceId, testUserId)).map((n) => [n.id, n])
    )
    expect(byId.get(b.id)!.positionY).toBeGreaterThan(byId.get(a.id)!.positionY)
    expect(byId.get(c.id)!.positionY).toBeGreaterThan(byId.get(b.id)!.positionY)
  })

  it('trim fix - título con solo espacios debe fallar validación', async () => {
    await expect(
      canvasService.createNode(testWorkspaceId, testUserId, {
        type: 'note',
        title: '   ',
      })
    ).rejects.toThrow()
    expect((await canvasService.listNodes(testWorkspaceId, testUserId)).length).toBe(0)

    // título con espacios alrededor debe trimearse y pasar
    const node = await canvasService.createNode(testWorkspaceId, testUserId, {
      type: 'note',
      title: '  Hola mundo  ',
    })
    expect(node.title).toBe('Hola mundo')
  })
})
