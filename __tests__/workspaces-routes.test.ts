import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/lib/db'
import { users, workspaces, workspaceMembers, nodes } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const ownerId = uuidv4()
const wsId = uuidv4()

// Usuario miembro (no owner) y workspace ajeno donde es miembro
const memberId = uuidv4()
const otherOwnerId = uuidv4()
const memberWsId = uuidv4()

// Mock getSession para probar rutas autenticadas
vi.mock('@/lib/auth/session', () => ({
  getSession: vi.fn(),
}))

import { getSession } from '@/lib/auth/session'
import { GET as getWorkspaces, POST as postWorkspaces } from '@/app/api/workspaces/route'
import { GET as getWorkspaceById } from '@/app/api/workspaces/[id]/route'
import { GET as getNodes, POST as postNodes } from '@/app/api/workspaces/[id]/nodes/route'
import { GET as getEdges, POST as postEdges } from '@/app/api/workspaces/[id]/edges/route'
import { GET as getEvents } from '@/app/api/workspaces/[id]/events/route'

const mockGetSession = getSession as unknown as ReturnType<typeof vi.fn>

describe('workspaces API routes', () => {
  beforeAll(async () => {
    await db.insert(users).values({
      id: ownerId,
      email: `route-owner-${ownerId.slice(0, 8)}@example.com`,
      passwordHash: 'hash',
      displayName: 'Route Owner',
      emailVerified: true,
    })
    await db.insert(workspaces).values({
      id: wsId,
      ownerId,
      name: 'Route WS',
      slug: `route-ws-${wsId.slice(0, 8)}`,
    })
    await db.insert(workspaceMembers).values({
      id: uuidv4(),
      workspaceId: wsId,
      userId: ownerId,
      role: 'owner',
    })

    // Setup para el caso member-only: otro owner + workspace ajeno + member
    await db.insert(users).values({
      id: otherOwnerId,
      email: `route-other-owner-${otherOwnerId.slice(0, 8)}@example.com`,
      passwordHash: 'hash',
      displayName: 'Other Owner',
      emailVerified: true,
    })
    await db.insert(users).values({
      id: memberId,
      email: `route-member-${memberId.slice(0, 8)}@example.com`,
      passwordHash: 'hash',
      displayName: 'Route Member',
      emailVerified: true,
    })
    await db.insert(workspaces).values({
      id: memberWsId,
      ownerId: otherOwnerId,
      name: 'Member WS',
      slug: `member-ws-${memberWsId.slice(0, 8)}`,
    })
    await db.insert(workspaceMembers).values({
      id: uuidv4(),
      workspaceId: memberWsId,
      userId: memberId,
      role: 'member',
    })
  })

  afterAll(async () => {
    await db.delete(nodes).where(eq(nodes.workspaceId, wsId))
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, wsId))
    await db.delete(workspaces).where(eq(workspaces.id, wsId))
    await db.delete(users).where(eq(users.id, ownerId))

    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, memberWsId))
    await db.delete(workspaces).where(eq(workspaces.id, memberWsId))
    await db.delete(users).where(eq(users.id, memberId))
    await db.delete(users).where(eq(users.id, otherOwnerId))
  })

  beforeEach(() => {
    mockGetSession.mockReset()
  })

  it('401 sin sesión en GET /api/workspaces', async () => {
    mockGetSession.mockResolvedValue(null)
    const res = await getWorkspaces()
    expect(res.status).toBe(401)
  })

  it('401 sin sesión en GET /api/workspaces/:id/nodes', async () => {
    mockGetSession.mockResolvedValue(null)
    const res = await getNodes(new Request('http://localhost/api/workspaces/x/nodes'), { params: Promise.resolve({ id: wsId }) })
    expect(res.status).toBe(401)
  })

  it('401 sin sesión en GET /api/workspaces/:id/events', async () => {
    mockGetSession.mockResolvedValue(null)
    const res = await getEvents(new Request('http://localhost/api/workspaces/x/events'), { params: Promise.resolve({ id: wsId }) })
    expect(res.status).toBe(401)
  })

  it('GET /api/workspaces con sesión retorna workspaces con role', async () => {
    mockGetSession.mockResolvedValue({ userId: ownerId, token: 'tok' })
    const res = await getWorkspaces()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json.workspaces)).toBe(true)
    const found = json.workspaces.find((w: { id: string }) => w.id === wsId)
    expect(found).toBeDefined()
    expect(found.role).toBe('owner')
  })

  it('GET /api/workspaces member-only retorna name/slug/role correctos (no vacíos)', async () => {
    mockGetSession.mockResolvedValue({ userId: memberId, token: 'tok' })
    const res = await getWorkspaces()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json.workspaces)).toBe(true)
    const found = json.workspaces.find((w: { id: string }) => w.id === memberWsId)
    expect(found).toBeDefined()
    expect(found.name).toBe('Member WS')
    expect(found.slug).toBe(`member-ws-${memberWsId.slice(0, 8)}`)
    expect(found.role).toBe('member')
    expect(found.createdAt).toBeTruthy()
  })

  it('GET /api/workspaces/:id retorna workspace con role', async () => {
    mockGetSession.mockResolvedValue({ userId: ownerId, token: 'tok' })
    const res = await getWorkspaceById(new Request('http://localhost/api/workspaces/x'), { params: Promise.resolve({ id: wsId }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.workspace.id).toBe(wsId)
    expect(json.workspace.role).toBe('owner')
  })

  it('POST /api/workspaces crea workspace 201', async () => {
    mockGetSession.mockResolvedValue({ userId: ownerId, token: 'tok' })
    const slug = `route-new-${uuidv4().slice(0, 8)}`
    const res = await postWorkspaces(
      new Request('http://localhost/api/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Nuevo WS', slug }),
      })
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.workspace.slug).toBe(slug)
    expect(json.workspace.name).toBe('Nuevo WS')

    // limpiar
    const created = await db.select().from(workspaces).where(eq(workspaces.slug, slug)).get()
    if (created) {
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, created.id))
      await db.delete(workspaces).where(eq(workspaces.id, created.id))
    }
  })

  it('POST /api/workspaces slug duplicado 409', async () => {
    mockGetSession.mockResolvedValue({ userId: ownerId, token: 'tok' })
    const slug = `route-ws-${wsId.slice(0, 8)}` // ya existe
    const res = await postWorkspaces(
      new Request('http://localhost/api/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Dup', slug }),
      })
    )
    expect(res.status).toBe(409)
  })

  it('POST /api/workspaces datos inválidos 400', async () => {
    mockGetSession.mockResolvedValue({ userId: ownerId, token: 'tok' })
    const res = await postWorkspaces(
      new Request('http://localhost/api/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'A', slug: 'x' }),
      })
    )
    expect(res.status).toBe(400)
  })

  it('GET /api/workspaces/:id/nodes retorna { nodes, pagination }', async () => {
    mockGetSession.mockResolvedValue({ userId: ownerId, token: 'tok' })
    const res = await getNodes(new Request('http://localhost/api/workspaces/x/nodes?limit=10&offset=0'), {
      params: Promise.resolve({ id: wsId }),
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json.nodes)).toBe(true)
    expect(json.pagination).toBeDefined()
    expect(json.pagination.limit).toBe(10)
    expect(json.pagination.offset).toBe(0)
    expect(typeof json.pagination.hasMore).toBe('boolean')
  })

  it('GET /api/workspaces/:id/nodes hasMore valor real (true en offset 0, false en última página)', async () => {
    mockGetSession.mockResolvedValue({ userId: ownerId, token: 'tok' })

    // Workspace dedicado para no interferir con otros tests
    const pagWsId = uuidv4()
    await db.insert(workspaces).values({
      id: pagWsId,
      ownerId,
      name: 'Pagination WS',
      slug: `pag-ws-${pagWsId.slice(0, 8)}`,
    })
    await db.insert(workspaceMembers).values({
      id: uuidv4(),
      workspaceId: pagWsId,
      userId: ownerId,
      role: 'owner',
    })

    const limit = 5
    const total = limit + 1 // 6 nodos -> 2 páginas

    // Insertar nodos directamente (más eficiente que POST)
    const base = Date.now()
    for (let i = 0; i < total; i++) {
      const ts = new Date(base + i)
      await db.insert(nodes).values({
        id: uuidv4(),
        workspaceId: pagWsId,
        createdBy: ownerId,
        type: 'note',
        title: `Pag node ${i}`,
        createdAt: ts,
        updatedAt: ts,
        deletedAt: null,
      })
    }

    try {
      // offset 0 con limit pequeño -> hay más páginas
      const res1 = await getNodes(
        new Request(`http://localhost/api/workspaces/x/nodes?limit=${limit}&offset=0`),
        { params: Promise.resolve({ id: pagWsId }) }
      )
      expect(res1.status).toBe(200)
      const json1 = await res1.json()
      expect(json1.nodes.length).toBe(limit)
      expect(json1.pagination.hasMore).toBe(true)
      expect(json1.pagination.count).toBe(total)

      // última página -> no hay más
      const res2 = await getNodes(
        new Request(`http://localhost/api/workspaces/x/nodes?limit=${limit}&offset=${limit}`),
        { params: Promise.resolve({ id: pagWsId }) }
      )
      expect(res2.status).toBe(200)
      const json2 = await res2.json()
      expect(json2.nodes.length).toBe(total - limit)
      expect(json2.pagination.hasMore).toBe(false)
      expect(json2.pagination.count).toBe(total)
    } finally {
      // limpiar
      await db.delete(nodes).where(eq(nodes.workspaceId, pagWsId))
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, pagWsId))
      await db.delete(workspaces).where(eq(workspaces.id, pagWsId))
    }
  })

  it('POST /api/workspaces/:id/nodes crea nodo 201', async () => {
    mockGetSession.mockResolvedValue({ userId: ownerId, token: 'tok' })
    const res = await postNodes(
      new Request('http://localhost/api/workspaces/x/nodes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'note', title: 'Nodo route' }),
      }),
      { params: Promise.resolve({ id: wsId }) }
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.node.title).toBe('Nodo route')
    expect(json.node.workspaceId).toBe(wsId)
  })

  it('GET /api/workspaces/:id/edges retorna { edges, pagination }', async () => {
    mockGetSession.mockResolvedValue({ userId: ownerId, token: 'tok' })
    const res = await getEdges(new Request('http://localhost/api/workspaces/x/edges'), { params: Promise.resolve({ id: wsId }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json.edges)).toBe(true)
    expect(json.pagination).toBeDefined()
  })

  it('POST /api/workspaces/:id/edges crea edge 201', async () => {
    mockGetSession.mockResolvedValue({ userId: ownerId, token: 'tok' })
    // crear dos nodos
    const n1 = await postNodes(
      new Request('http://localhost/api/workspaces/x/nodes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'note', title: 'E1' }),
      }),
      { params: Promise.resolve({ id: wsId }) }
    )
    const j1 = await n1.json()
    const n2 = await postNodes(
      new Request('http://localhost/api/workspaces/x/nodes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'note', title: 'E2' }),
      }),
      { params: Promise.resolve({ id: wsId }) }
    )
    const j2 = await n2.json()

    const res = await postEdges(
      new Request('http://localhost/api/workspaces/x/edges', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceId: j1.node.id, targetId: j2.node.id, type: 'related_to' }),
      }),
      { params: Promise.resolve({ id: wsId }) }
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.edge.sourceId).toBe(j1.node.id)
    expect(json.edge.targetId).toBe(j2.node.id)
  })

  it('GET /api/workspaces/:id/events - SSE connected + heartbeat + relay node:created', async () => {
    mockGetSession.mockResolvedValue({ userId: ownerId, token: 'tok' })
    const res = await getEvents(new Request('http://localhost/api/workspaces/x/events'), { params: Promise.resolve({ id: wsId }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()

    // Leer primer chunk: evento connected
    const first = await reader.read()
    const firstText = decoder.decode(first.value)
    expect(firstText).toContain('event: connected')
    expect(firstText).toContain(wsId)

    // Crear nodo en otra "conexión" -> debe llegar como node:created
    const nodeRes = await postNodes(
      new Request('http://localhost/api/workspaces/x/nodes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'note', title: 'SSE node' }),
      }),
      { params: Promise.resolve({ id: wsId }) }
    )
    expect(nodeRes.status).toBe(201)

    const second = await reader.read()
    const secondText = decoder.decode(second.value)
    expect(secondText).toContain('event: node:created')
    expect(secondText).toContain('SSE node')

    // Cerrar stream
    await reader.cancel()
  })
})
