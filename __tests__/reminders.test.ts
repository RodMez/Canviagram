import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/lib/db'
import { users, workspaces, workspaceMembers, nodes, notifications } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { runReminderSweep, reminderAtMs } from '@/lib/reminders/engine'
import { resolveReminderFields, DEFAULT_REMINDER_OFFSET_MIN } from '@/lib/canvas-service'
import { createNodeSchema } from '@/lib/validators/node'

// Mock de canales de entrega (push + telegram) para aislar la lógica del sweeper.
vi.mock('@/lib/push/send', () => ({
  sendPushToWorkspace: vi.fn(async () => ({ sent: 0, total: 0 })),
}))
vi.mock('@/lib/telegram/notify', () => ({
  sendProactiveTelegramToUsers: vi.fn(async () => ({ sent: 0 })),
}))

import { sendPushToWorkspace } from '@/lib/push/send'
import { sendProactiveTelegramToUsers } from '@/lib/telegram/notify'

const mSendPush = vi.mocked(sendPushToWorkspace)
const mSendTelegram = vi.mocked(sendProactiveTelegramToUsers)

// ============================================================
// Fase 3: recordatorios (dueDate/reminderOffsetMin/notifiedAt)
// ============================================================

const ownerId = uuidv4()
const memberId = uuidv4()
const wsId = uuidv4()

async function cleanup() {
  try {
    await db.delete(notifications).where(eq(notifications.workspaceId, wsId))
    await db.delete(nodes).where(eq(nodes.workspaceId, wsId))
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, wsId))
    await db.delete(workspaces).where(eq(workspaces.id, wsId))
    await db.delete(users).where(eq(users.id, ownerId))
    await db.delete(users).where(eq(users.id, memberId))
  } catch {
    // ignore
  }
}

describe('reminders (Fase 3)', () => {
  beforeAll(async () => {
    await cleanup()
    await db.insert(users).values([
      { id: ownerId, email: `rem-owner-${ownerId.slice(0, 8)}@example.com`, passwordHash: 'x', displayName: 'Rem Owner', createdAt: new Date(), updatedAt: new Date() },
      { id: memberId, email: `rem-member-${memberId.slice(0, 8)}@example.com`, passwordHash: 'x', displayName: 'Rem Member', createdAt: new Date(), updatedAt: new Date() },
    ])
    await db.insert(workspaces).values({
      id: wsId,
      ownerId,
      name: 'Rem WS',
      slug: `rem-ws-${wsId.slice(0, 8)}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await db.insert(workspaceMembers).values({
      id: uuidv4(),
      workspaceId: wsId,
      userId: memberId,
      role: 'member',
      createdAt: new Date(),
    })
  })

  afterAll(async () => {
    await cleanup()
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    mSendPush.mockClear()
    mSendTelegram.mockClear()
  })

  it('reminderAtMs calcula dueDate menos offset', () => {
    const due = new Date('2026-09-10T12:00:00Z')
    expect(reminderAtMs({ dueDate: due, reminderOffsetMin: 60 })).toBe(
      due.getTime() - 60 * 60_000
    )
    expect(reminderAtMs({ dueDate: due, reminderOffsetMin: null })).toBe(due.getTime())
    expect(reminderAtMs({ dueDate: null, reminderOffsetMin: 15 })).toBeNull()
  })

  it('resolveReminderFields: default 15 min, resetea notifiedAt al cambiar dueDate/offset', () => {
    const existing = { dueDate: null, reminderOffsetMin: null, notifiedAt: null }
    const withDue = resolveReminderFields({ dueDate: 1_700_000_000_000 }, existing)
    expect(withDue.dueDate).toEqual(new Date(1_700_000_000_000))
    expect(withDue.reminderOffsetMin).toBe(DEFAULT_REMINDER_OFFSET_MIN)

    const existingNotified = { dueDate: new Date(1_700_000_000_000), reminderOffsetMin: 15, notifiedAt: new Date() }
    const changed = resolveReminderFields({ dueDate: 1_700_000_000_500 }, existingNotified)
    expect(changed.notifiedAt).toBeNull()
    const same = resolveReminderFields({ dueDate: 1_700_000_000_000 }, existingNotified)
    expect(same.notifiedAt).toEqual(existingNotified.notifiedAt)
  })

  it('validators aceptan dueDate/reminderOffsetMin', () => {
    const parsed = createNodeSchema.parse({
      type: 'task',
      title: 'Tarea',
      dueDate: 1_700_000_000_000,
      reminderOffsetMin: 60,
    })
    expect(parsed.dueDate).toBe(1_700_000_000_000)
    expect(parsed.reminderOffsetMin).toBe(60)
    expect(() =>
      createNodeSchema.parse({ type: 'task', title: 'T', reminderOffsetMin: -5 })
    ).toThrow()
  })

  it('sweep notifica a todos los miembros, marca notifiedAt y entrega por push/telegram', async () => {
    const dueDate = new Date(Date.now() - 2 * 60_000) // vencido hace 2 min
    const [node] = await db
      .insert(nodes)
      .values({
        id: uuidv4(),
        workspaceId: wsId,
        createdBy: ownerId,
        type: 'task',
        title: 'Entregar informe',
        content: null,
        status: 'todo',
        dueDate,
        reminderOffsetMin: 15,
        notifiedAt: null,
        positionX: 0,
        positionY: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      })
      .returning()

    const result = await runReminderSweep(new Date())

    expect(result.reminded).toBe(1)

    const notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.nodeId, node!.id))
      .all()
    expect(notifs).toHaveLength(2) // owner + member
    expect(notifs.map((n) => n.userId).sort()).toEqual([memberId, ownerId].sort())
    expect(notifs.every((n) => n.kind === 'reminder' && n.title === '⏰ Recordatorio')).toBe(true)

    const updated = await db.select().from(nodes).where(eq(nodes.id, node!.id)).get()
    expect(updated!.notifiedAt).not.toBeNull()

    expect(mSendPush).toHaveBeenCalledWith(wsId, expect.objectContaining({ title: '⏰ Recordatorio' }))
    expect(mSendTelegram).toHaveBeenCalledWith(
      expect.arrayContaining([ownerId, memberId]),
      expect.stringContaining('Entregar informe')
    )
  })

  it('idempotente: un segundo sweep no re-notifica', async () => {
    const [node] = await db
      .insert(nodes)
      .values({
        id: uuidv4(),
        workspaceId: wsId,
        createdBy: ownerId,
        type: 'task',
        title: 'Solo una vez',
        content: null,
        status: 'todo',
        dueDate: new Date(Date.now() - 60_000),
        reminderOffsetMin: 0,
        notifiedAt: null,
        positionX: 0,
        positionY: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      })
      .returning()

    await runReminderSweep(new Date())
    const second = await runReminderSweep(new Date())

    expect(second.reminded).toBe(0)
    const notifs = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.nodeId, node!.id), eq(notifications.kind, 'reminder')))
      .all()
    expect(notifs).toHaveLength(2)
  })

  it('sweep NO notifica nodos cuyo recordatorio aún no llegó', async () => {
    const [node] = await db
      .insert(nodes)
      .values({
        id: uuidv4(),
        workspaceId: wsId,
        createdBy: ownerId,
        type: 'task',
        title: 'Futuro',
        content: null,
        status: 'todo',
        dueDate: new Date(Date.now() + 2 * 60 * 60_000),
        reminderOffsetMin: 60,
        notifiedAt: null,
        positionX: 0,
        positionY: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      })
      .returning()

    const result = await runReminderSweep(new Date())

    const mine = await db.select().from(nodes).where(eq(nodes.id, node!.id)).get()
    expect(mine!.notifiedAt).toBeNull()
    const notifs = await db.select().from(notifications).where(eq(notifications.nodeId, node!.id)).all()
    expect(notifs).toHaveLength(0)
    expect(result.reminded).toBe(0)
  })
})