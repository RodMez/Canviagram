import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/lib/db'
import { users, workspaces, workspaceMembers, chatMessages } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import {
  buildWebChatKey,
  buildTelegramChatKey,
  appendChatMessages,
  appendAndTrimChatMessages,
  listChatMessages,
  trimChatMessages,
  clearChatMessages,
} from '@/lib/chat/repository'

vi.mock('@/lib/auth/session', () => ({
  getSession: vi.fn(),
}))

import { getSession } from '@/lib/auth/session'
import { GET as getMessages, POST as postMessages, DELETE as deleteMessages } from '@/app/api/workspaces/[id]/chat/messages/route'

const mockGetSession = getSession as unknown as ReturnType<typeof vi.fn>

const ownerId = uuidv4()
const memberId = uuidv4()
const outsiderId = uuidv4()
const wsId = uuidv4()
const wsSlug = `chat-ws-${wsId.slice(0, 8)}`

async function cleanupWorkspace(wId: string) {
  try {
    await db.delete(chatMessages).where(eq(chatMessages.workspaceId, wId))
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, wId))
    await db.delete(workspaces).where(eq(workspaces.id, wId))
  } catch {
    /* ignore */
  }
}

async function cleanupUser(uId: string) {
  try {
    await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, uId))
    await db.delete(users).where(eq(users.id, uId))
  } catch {
    /* ignore */
  }
}

describe('chat-messages repository', () => {
  beforeAll(async () => {
    // Idempotencia: el suite comparte la DB dev; purga cualquier residuo previo.
    try {
      await db.delete(chatMessages).where(eq(chatMessages.workspaceId, wsId))
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, wsId))
      await db.delete(workspaces).where(eq(workspaces.id, wsId))
    } catch {
      /* ignore */
    }
  })

  it('buildWebChatKey identity y buildTelegramChatKey con prefijo', () => {
    expect(buildWebChatKey('user-1')).toBe('user-1')
    expect(buildTelegramChatKey('c1', 't1')).toBe('tg:c1:t1')
  })

  it('append + trim mantiene como máximo CHAT_MESSAGES_CAP conservando los más recientes', async () => {
    const userId = uuidv4()
    await db.insert(users).values({
      id: userId,
      email: `rep-${userId.slice(0, 8)}@example.com`,
      passwordHash: 'hash',
      displayName: 'Repo User',
    })
    await db.insert(workspaces).values({ id: wsId, ownerId: userId, name: 'Chat WS', slug: `chat-rep-a-${userId.slice(0, 8)}` })
    await db.insert(workspaceMembers).values({ id: uuidv4(), workspaceId: wsId, userId, role: 'owner' })

    const chatKey = buildWebChatKey(userId)
    const batch = (from: number, to: number): { role: 'user' | 'assistant'; content: string }[] =>
      Array.from({ length: to - from }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `msg-${from + i}`,
      }))

    await appendAndTrimChatMessages({ workspaceId: wsId, chatKey, source: 'web', messages: batch(0, 100) })
    await appendAndTrimChatMessages({ workspaceId: wsId, chatKey, source: 'web', messages: batch(100, 200) })
    await appendAndTrimChatMessages({ workspaceId: wsId, chatKey, source: 'web', messages: batch(200, 300) })

    const rows = await db
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(and(eq(chatMessages.workspaceId, wsId), eq(chatMessages.chatKey, chatKey)))
    const listed = await listChatMessages({ workspaceId: wsId, chatKey })

    // Cap 200: se borraron los 100 más antiguos (msg-0..msg-99)
    expect(rows.length).toBe(200)
    expect(listed.length).toBe(200)
    expect(listed[0].content).toBe('msg-100')
    expect(listed[199].content).toBe('msg-299')

    await clearChatMessages(wsId, chatKey)
    expect(await listChatMessages({ workspaceId: wsId, chatKey })).toEqual([])
    await cleanupWorkspace(wsId)
    await cleanupUser(userId)
  })

  it('trimChatMessages no borra nada si hay <= cap', async () => {
    const userId = uuidv4()
    await db.insert(users).values({
      id: userId,
      email: `rep2-${userId.slice(0, 8)}@example.com`,
      passwordHash: 'hash',
      displayName: 'Repo User 2',
    })
    await db.insert(workspaces).values({ id: wsId, ownerId: userId, name: 'Chat WS', slug: `chat-rep-b-${userId.slice(0, 8)}` })
    await db.insert(workspaceMembers).values({ id: uuidv4(), workspaceId: wsId, userId, role: 'owner' })

    const chatKey = buildWebChatKey(userId)
    await appendChatMessages({
      workspaceId: wsId,
      chatKey,
      source: 'web',
      messages: [{ role: 'user', content: 'hola' }],
    })
    const removed = await trimChatMessages(wsId, chatKey)
    expect(removed).toBe(0)
    expect((await listChatMessages({ workspaceId: wsId, chatKey })).length).toBe(1)

    await clearChatMessages(wsId, chatKey)
    await cleanupWorkspace(wsId)
    await cleanupUser(userId)
  })

  it('source telegram se persiste y se lista igual', async () => {
    const userId = uuidv4()
    await db.insert(users).values({
      id: userId,
      email: `rep3-${userId.slice(0, 8)}@example.com`,
      passwordHash: 'hash',
      displayName: 'Repo User 3',
    })
    await db.insert(workspaces).values({ id: wsId, ownerId: userId, name: 'Chat WS', slug: `chat-rep-c-${userId.slice(0, 8)}` })
    await db.insert(workspaceMembers).values({ id: uuidv4(), workspaceId: wsId, userId, role: 'owner' })

    const chatKey = buildTelegramChatKey('c-1', 't-1')
    await appendAndTrimChatMessages({
      workspaceId: wsId,
      chatKey,
      source: 'telegram',
      messages: [
        { role: 'user', content: 'desde telegram' },
        { role: 'assistant', content: 'ok' },
      ],
    })
    const listed = await listChatMessages({ workspaceId: wsId, chatKey })
    expect(listed.map((m) => m.content)).toEqual(['desde telegram', 'ok'])
    const rows = await db
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.workspaceId, wsId), eq(chatMessages.chatKey, chatKey)))
    expect(rows[0].source).toBe('telegram')

    await clearChatMessages(wsId, chatKey)
    await cleanupWorkspace(wsId)
    await cleanupUser(userId)
  })
})

describe('chat-messages API routes', () => {
  beforeAll(async () => {
    try {
      await db.delete(chatMessages).where(eq(chatMessages.workspaceId, wsId))
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, wsId))
      await db.delete(workspaces).where(eq(workspaces.id, wsId))
    } catch {
      /* ignore */
    }
    const userIds = [ownerId, memberId]
    for (const id of userIds) {
      await db.insert(users).values({
        id,
        email: `route-${id.slice(0, 8)}@example.com`,
        passwordHash: 'hash',
        displayName: 'Route User',
        emailVerified: true,
      })
    }
    await db.insert(workspaces).values({ id: wsId, ownerId, name: 'Chat WS', slug: wsSlug })
    await db.insert(workspaceMembers).values({ id: uuidv4(), workspaceId: wsId, userId: ownerId, role: 'owner' })
    await db.insert(workspaceMembers).values({ id: uuidv4(), workspaceId: wsId, userId: memberId, role: 'member' })
    mockGetSession.mockReset()
  })

  afterAll(async () => {
    await cleanupWorkspace(wsId)
    await cleanupUser(ownerId)
    await cleanupUser(memberId)
    await cleanupUser(outsiderId)
  })

  it('401 sin sesión', async () => {
    mockGetSession.mockResolvedValueOnce(null)
    const res = await getMessages(new Request(`http://localhost/api/workspaces/${wsId}/chat/messages`), {
      params: Promise.resolve({ id: wsId }),
    })
    expect(res.status).toBe(401)
  })

  it('403 para usuario fuera del workspace', async () => {
    mockGetSession.mockResolvedValueOnce({ userId: outsiderId, token: 't' })
    const res = await getMessages(new Request(`http://localhost/api/workspaces/${wsId}/chat/messages`), {
      params: Promise.resolve({ id: wsId }),
    })
    expect(res.status).toBe(403)
  })

  it('POST persiste un turno y GET lo devuelve cronológico', async () => {
    mockGetSession.mockResolvedValue({ userId: ownerId, token: 't' })

    const post = await postMessages(
      new Request(`http://localhost/api/workspaces/${wsId}/chat/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'user', content: 'crea un nodo proyecto' },
            { role: 'assistant', content: 'Listo, creé el nodo.' },
          ],
        }),
      }),
      { params: Promise.resolve({ id: wsId }) }
    )
    expect(post.status).toBe(201)
    const postBody = await post.json()
    expect(postBody.messages).toHaveLength(2)
    expect(postBody.messages[0].role).toBe('user')
    expect(postBody.messages[1].content).toBe('Listo, creé el nodo.')

    const get = await getMessages(new Request(`http://localhost/api/workspaces/${wsId}/chat/messages`), {
      params: Promise.resolve({ id: wsId }),
    })
    expect(get.status).toBe(200)
    const getBody = await get.json()
    expect(getBody.messages.map((m: { content: string }) => m.content)).toEqual([
      'crea un nodo proyecto',
      'Listo, creé el nodo.',
    ])
  })

  it('POST no mezcla historiales de usuarios distintos (chatKey por userId)', async () => {
    mockGetSession.mockResolvedValue({ userId: memberId, token: 't' })
    const getMember = await getMessages(new Request(`http://localhost/api/workspaces/${wsId}/chat/messages`), {
      params: Promise.resolve({ id: wsId }),
    })
    const body = await getMember.json()
    expect(body.messages).toEqual([])
  })

  it('DELETE limpia el historial del usuario', async () => {
    mockGetSession.mockResolvedValue({ userId: ownerId, token: 't' })
    const del = await deleteMessages(new Request(`http://localhost/api/workspaces/${wsId}/chat/messages`, { method: 'DELETE' }), {
      params: Promise.resolve({ id: wsId }),
    })
    expect(del.status).toBe(204)

    const get = await getMessages(new Request(`http://localhost/api/workspaces/${wsId}/chat/messages`), {
      params: Promise.resolve({ id: wsId }),
    })
    const body = await get.json()
    expect(body.messages).toEqual([])
  })

  it('validación: mensaje vacío, exceso de tamaño y array vacío → 400', async () => {
    mockGetSession.mockResolvedValue({ userId: ownerId, token: 't' })

    async function postBody(messages: unknown) {
      return postMessages(
        new Request(`http://localhost/api/workspaces/${wsId}/chat/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages }),
        }),
        { params: Promise.resolve({ id: wsId }) }
      )
    }

    expect((await postBody([{ role: 'user', content: '   ' }])).status).toBe(400)
    expect((await postBody([])).status).toBe(400)
    expect(
      (
        await postBody([{ role: 'user', content: 'x'.repeat(4001) }])
      ).status
    ).toBe(400)
    expect((await postBody([{ role: 'system', content: 'hola' }])).status).toBe(400)
  })
})