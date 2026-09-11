import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/lib/db'
import { users, workspaces, nodes, workspaceMembers } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { bucketFor, getTodayItems } from '@/lib/today-service'

// ============================================================
// F5.4: agregado cross-workspace de la vista Hoy
// ============================================================

const ownerId = uuidv4()
const viewerId = uuidv4()
const wsA = uuidv4()
const wsB = uuidv4()

async function cleanup() {
  try {
    await db.delete(nodes).where(eq(nodes.workspaceId, wsA))
    await db.delete(nodes).where(eq(nodes.workspaceId, wsB))
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, wsA))
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, wsB))
    await db.delete(workspaces).where(eq(workspaces.id, wsA))
    await db.delete(workspaces).where(eq(workspaces.id, wsB))
    await db.delete(users).where(eq(users.id, ownerId))
    await db.delete(users).where(eq(users.id, viewerId))
  } catch {
    // ignore
  }
}

async function addNode(
  workspaceId: string,
  overrides: Partial<{ title: string; type: 'task' | 'note'; status: 'todo' | 'in_progress' | 'done' | null; dueDate: Date | null }>
) {
  const [node] = await db
    .insert(nodes)
    .values({
      id: uuidv4(),
      workspaceId,
      createdBy: ownerId,
      type: overrides.type ?? 'task',
      title: overrides.title ?? 'T',
      content: null,
      status: overrides.status !== undefined ? overrides.status : 'todo',
      dueDate: overrides.dueDate !== undefined ? overrides.dueDate : null,
      reminderOffsetMin: null,
      notifiedAt: null,
      recurrenceRule: null,
      positionX: 0,
      positionY: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    })
    .returning()
  return node!
}

describe('today-service (F5.4)', () => {
  beforeAll(async () => {
    await cleanup()
    await db.insert(users).values([
      { id: ownerId, email: `today-owner-${ownerId.slice(0, 8)}@example.com`, passwordHash: 'x', displayName: 'Today Owner', createdAt: new Date(), updatedAt: new Date() },
      { id: viewerId, email: `today-viewer-${viewerId.slice(0, 8)}@example.com`, passwordHash: 'x', displayName: 'Today Viewer', createdAt: new Date(), updatedAt: new Date() },
    ])
    await db.insert(workspaces).values([
      { id: wsA, ownerId, name: 'WS A', slug: `today-a-${wsA.slice(0, 8)}`, createdAt: new Date(), updatedAt: new Date() },
      { id: wsB, ownerId, name: 'WS B', slug: `today-b-${wsB.slice(0, 8)}`, createdAt: new Date(), updatedAt: new Date() },
    ])
    // viewer es solo viewer de wsB: la vista Hoy es lectura, sí aparece.
    await db.insert(workspaceMembers).values({
      id: uuidv4(),
      workspaceId: wsB,
      userId: viewerId,
      role: 'viewer',
      createdAt: new Date(),
    })
  })

  afterAll(async () => {
    await cleanup()
  })

  it('bucketFor clasifica vencido/hoy/próximo/sin-fecha', () => {
    const now = new Date('2026-09-11T12:00:00')
    expect(bucketFor(new Date('2026-09-10T12:00:00'), 'todo', now)).toBe('overdue')
    expect(bucketFor(new Date('2026-09-11T18:00:00'), 'todo', now)).toBe('today')
    expect(bucketFor(new Date('2026-09-15T12:00:00'), 'todo', now)).toBe('upcoming')
    expect(bucketFor(new Date('2026-12-01T12:00:00'), 'in_progress', now)).toBe('upcoming')
    expect(bucketFor(null, 'in_progress', now)).toBe('in_progress')
    expect(bucketFor(null, 'todo', now)).toBe('backlog')
  })

  it('agrega nodos de TODOS los workspaces, vencido antes que próximo', async () => {
    await addNode(wsA, { title: 'Vencida A', dueDate: new Date(Date.now() - 60_000) })
    await addNode(wsB, { title: 'Futura B', dueDate: new Date(Date.now() + 3 * 24 * 60 * 60_000) })
    await addNode(wsA, { title: 'Backlog A', status: 'todo', dueDate: null })

    const items = await getTodayItems(ownerId)
    expect(items.length).toBe(3)
    // Orden: overdue → upcoming → backlog.
    expect(items.map((i) => i.title)).toEqual(['Vencida A', 'Futura B', 'Backlog A'])
    expect(items[0].bucket).toBe('overdue')
    expect(items[0].workspaceSlug).toContain('today-a-')
    expect(items[1].workspaceSlug).toContain('today-b-')
  })

  it('nodo done no aparece; nota con dueDate sí aunque no sea task', async () => {
    await addNode(wsA, { title: 'Hecha', status: 'done', dueDate: new Date(Date.now() - 60_000) })
    await addNode(wsA, { title: 'Nota con fecha', type: 'note', status: null, dueDate: new Date(Date.now() + 60_000) })

    const items = await getTodayItems(ownerId)
    const titles = items.map((i) => i.title)
    expect(titles).not.toContain('Hecha')
    expect(titles).toContain('Nota con fecha')
  })

  it('nota/idea sin fecha no aparece; viewer ve (lectura)', async () => {
    await addNode(wsB, { title: 'Idea suelta', type: 'note', status: null, dueDate: null })

    const ownerItems = await getTodayItems(ownerId)
    expect(ownerItems.map((i) => i.title)).not.toContain('Idea suelta')

    // viewer solo tiene wsB: ve lo de wsB, nada de wsA.
    const viewerItems = await getTodayItems(viewerId)
    expect(viewerItems.length).toBeGreaterThan(0)
    expect(viewerItems.every((i) => i.workspaceId === wsB)).toBe(true)
  })

  it('sin workspaces devuelve vacío', async () => {
    expect(await getTodayItems(uuidv4())).toEqual([])
    expect(await getTodayItems('')).toEqual([])
  })
})
