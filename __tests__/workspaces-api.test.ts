import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/lib/db'
import { users, workspaces, workspaceMembers } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { handleApiError, parseQueryInt } from '@/lib/api-helpers'
import { ValidationError, NotFoundError, ForbiddenError, ConflictError, GoneError } from '@/lib/errors'
import { assertWorkspaceAccess } from '@/lib/auth/workspace-access'

const ownerId = uuidv4()
const attackerId = uuidv4()
const wsAId = uuidv4()

describe('api-helpers', () => {
  it('parseQueryInt - fallback en NaN y null', () => {
    expect(parseQueryInt(null, 50)).toBe(50)
    expect(parseQueryInt('abc', 50)).toBe(50)
    expect(parseQueryInt('10', 50)).toBe(10)
    expect(parseQueryInt('', 50)).toBe(50)
    expect(parseQueryInt('-5', 50)).toBe(-5)
  })

  it('handleApiError - mapea errores a status correctos', async () => {
    expect((await handleApiError(new ValidationError('bad', { x: 1 }))).status).toBe(400)
    expect((await handleApiError(new NotFoundError('nope'))).status).toBe(404)
    expect((await handleApiError(new ForbiddenError('denied'))).status).toBe(403)
    expect((await handleApiError(new ConflictError('conflict'))).status).toBe(409)
    expect((await handleApiError(new GoneError('gone'))).status).toBe(410)
    expect((await handleApiError(new Error('boom'))).status).toBe(500)
  })

  it('handleApiError - ValidationError incluye details', async () => {
    const res = await handleApiError(new ValidationError('bad', { field: 'x' }))
    const json = await res.json()
    expect(json.error).toBe('bad')
    expect(json.details).toEqual({ field: 'x' })
  })
})

describe('workspace access (IDOR a nivel workspace)', () => {
  beforeAll(async () => {
    await db.insert(users).values({
      id: ownerId,
      email: `ws-owner-${ownerId.slice(0, 8)}@example.com`,
      passwordHash: 'hash',
      displayName: 'WS Owner',
      emailVerified: true,
    })
    await db.insert(users).values({
      id: attackerId,
      email: `ws-attacker-${attackerId.slice(0, 8)}@example.com`,
      passwordHash: 'hash',
      displayName: 'WS Attacker',
      emailVerified: true,
    })
    await db.insert(workspaces).values({
      id: wsAId,
      ownerId,
      name: 'WS A',
      slug: `ws-a-${wsAId.slice(0, 8)}`,
    })
    await db.insert(workspaceMembers).values({
      id: uuidv4(),
      workspaceId: wsAId,
      userId: ownerId,
      role: 'owner',
    })
  })

  afterAll(async () => {
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, wsAId))
    await db.delete(workspaces).where(eq(workspaces.id, wsAId))
    await db.delete(users).where(eq(users.id, ownerId))
    await db.delete(users).where(eq(users.id, attackerId))
  })

  it('owner obtiene role owner', async () => {
    const { role, workspace } = await assertWorkspaceAccess(wsAId, ownerId, 'viewer')
    expect(role).toBe('owner')
    expect(workspace.id).toBe(wsAId)
  })

  it('attacker (no miembro) recibe ForbiddenError', async () => {
    await expect(assertWorkspaceAccess(wsAId, attackerId, 'viewer')).rejects.toThrow()
    try {
      await assertWorkspaceAccess(wsAId, attackerId, 'viewer')
    } catch (e) {
      expect((e as Error).name).toBe('ForbiddenError')
    }
  })

  it('workspace inexistente recibe NotFoundError', async () => {
    await expect(assertWorkspaceAccess('ws-no-existe', ownerId, 'viewer')).rejects.toThrow()
    try {
      await assertWorkspaceAccess('ws-no-existe', ownerId, 'viewer')
    } catch (e) {
      expect((e as Error).name).toBe('NotFoundError')
    }
  })
})
