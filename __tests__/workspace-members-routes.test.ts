import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/lib/db'
import { users, workspaces, workspaceMembers, invitations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

// Mock getSession para probar rutas autenticadas
vi.mock('@/lib/auth/session', () => ({
  getSession: vi.fn(),
}))

// Mock sendInvitation para no enviar emails reales
vi.mock('@/lib/email/brevo', () => ({
  sendInvitation: vi.fn().mockResolvedValue(undefined),
}))

import { getSession } from '@/lib/auth/session'
import { GET as getMembers } from '@/app/api/workspaces/[id]/members/route'
import { POST as postInvite } from '@/app/api/workspaces/[id]/members/invite/route'
import { PATCH as patchMember, DELETE as deleteMember } from '@/app/api/workspaces/[id]/members/[userId]/route'

const mockGetSession = getSession as unknown as ReturnType<typeof vi.fn>

// ============================================================
// Setup — workspace con owner + admin + member + viewer
// ============================================================

const ownerId = uuidv4()
const adminId = uuidv4()
const memberId = uuidv4()
const viewerId = uuidv4()
const outsiderId = uuidv4()
const wsId = uuidv4()
const wsSlug = `mem-route-${wsId.slice(0, 8)}`

const createdUserIds: string[] = []
const createdWorkspaceIds: string[] = []

async function cleanupUser(userId: string) {
  try {
    await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, userId))
    await db.delete(invitations).where(eq(invitations.invitedBy, userId))
    await db.delete(users).where(eq(users.id, userId))
  } catch { /* ignore */ }
}

async function cleanupWorkspace(wId: string) {
  try {
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, wId))
    await db.delete(invitations).where(eq(invitations.workspaceId, wId))
    await db.delete(workspaces).where(eq(workspaces.id, wId))
  } catch { /* ignore */ }
}

describe('workspace members API routes', () => {
  beforeAll(async () => {
    const userIds = [ownerId, adminId, memberId, viewerId]
    const roles = ['owner', 'admin', 'member', 'viewer']
    for (let i = 0; i < userIds.length; i++) {
      await db.insert(users).values({
        id: userIds[i],
        email: `mem-${roles[i]}-${userIds[i].slice(0, 8)}@example.com`,
        passwordHash: 'hash',
        displayName: `Mem ${roles[i]}`,
        emailVerified: true,
      })
    }
    await db.insert(users).values({
      id: outsiderId,
      email: `mem-outsider-${outsiderId.slice(0, 8)}@example.com`,
      passwordHash: 'hash',
      displayName: 'Mem Outsider',
      emailVerified: true,
    })
    createdUserIds.push(ownerId, adminId, memberId, viewerId, outsiderId)

    await db.insert(workspaces).values({
      id: wsId,
      ownerId,
      name: 'Members WS',
      slug: wsSlug,
    })
    createdWorkspaceIds.push(wsId)

    await db.insert(workspaceMembers).values([
      { id: uuidv4(), workspaceId: wsId, userId: adminId, role: 'admin' },
      { id: uuidv4(), workspaceId: wsId, userId: memberId, role: 'member' },
      { id: uuidv4(), workspaceId: wsId, userId: viewerId, role: 'viewer' },
    ])
  })

  afterAll(async () => {
    for (const wId of createdWorkspaceIds) await cleanupWorkspace(wId)
    for (const uId of createdUserIds) await cleanupUser(uId)
  })

  beforeEach(() => {
    mockGetSession.mockReset()
  })

  // ============================================================
  // GET /members
  // ============================================================

  describe('GET /api/workspaces/[id]/members', () => {
    it('401 sin sesión', async () => {
      mockGetSession.mockResolvedValue(null)
      const res = await getMembers(new Request('http://localhost/api/workspaces/x/members'), { params: Promise.resolve({ id: wsId }) })
      expect(res.status).toBe(401)
    })

    it('viewer puede listar (lectura)', async () => {
      mockGetSession.mockResolvedValue({ userId: viewerId, token: 'tok' })
      const res = await getMembers(new Request('http://localhost/api/workspaces/x/members'), { params: Promise.resolve({ id: wsId }) })
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(Array.isArray(json.members)).toBe(true)
      expect(Array.isArray(json.invitations)).toBe(true)
      // owner presente con isOwner
      const owner = json.members.find((m: { isOwner: boolean }) => m.isOwner)
      expect(owner).toBeDefined()
      expect(owner.userId).toBe(ownerId)
    })

    it('outsider → 403', async () => {
      mockGetSession.mockResolvedValue({ userId: outsiderId, token: 'tok' })
      const res = await getMembers(new Request('http://localhost/api/workspaces/x/members'), { params: Promise.resolve({ id: wsId }) })
      expect(res.status).toBe(403)
    })
  })

  // ============================================================
  // POST /members/invite
  // ============================================================

  describe('POST /api/workspaces/[id]/members/invite', () => {
    it('401 sin sesión', async () => {
      mockGetSession.mockResolvedValue(null)
      const res = await postInvite(
        new Request('http://localhost/api/workspaces/x/members/invite', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'x@y.com', role: 'member' }),
        }),
        { params: Promise.resolve({ id: wsId }) }
      )
      expect(res.status).toBe(401)
    })

    it('viewer no puede invitar → 403', async () => {
      mockGetSession.mockResolvedValue({ userId: viewerId, token: 'tok' })
      const res = await postInvite(
        new Request('http://localhost/api/workspaces/x/members/invite', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'new@example.com', role: 'member' }),
        }),
        { params: Promise.resolve({ id: wsId }) }
      )
      expect(res.status).toBe(403)
    })

    it('admin invita → 201', async () => {
      mockGetSession.mockResolvedValue({ userId: adminId, token: 'tok' })
      const inviteEmail = `invite-route-${Date.now()}@example.com`
      const res = await postInvite(
        new Request('http://localhost/api/workspaces/x/members/invite', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: inviteEmail, role: 'member' }),
        }),
        { params: Promise.resolve({ id: wsId }) }
      )
      expect(res.status).toBe(201)
      const json = await res.json()
      expect(json.invitation.email).toBe(inviteEmail)
      expect(json.invitation.role).toBe('member')

      // cleanup
      await db.delete(invitations).where(
        and(eq(invitations.workspaceId, wsId), eq(invitations.email, inviteEmail))
      )
    })

    it('re-invitar pendiente → 200 idempotente', async () => {
      mockGetSession.mockResolvedValue({ userId: adminId, token: 'tok' })
      const inviteEmail = `idem-route-${Date.now()}@example.com`

      const first = await postInvite(
        new Request('http://localhost/api/workspaces/x/members/invite', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: inviteEmail, role: 'viewer' }),
        }),
        { params: Promise.resolve({ id: wsId }) }
      )
      expect(first.status).toBe(201)
      const firstJson = await first.json()

      const second = await postInvite(
        new Request('http://localhost/api/workspaces/x/members/invite', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: inviteEmail, role: 'viewer' }),
        }),
        { params: Promise.resolve({ id: wsId }) }
      )
      expect(second.status).toBe(200)
      const secondJson = await second.json()
      expect(secondJson.invitation.id).toBe(firstJson.invitation.id)

      await db.delete(invitations).where(
        and(eq(invitations.workspaceId, wsId), eq(invitations.email, inviteEmail))
      )
    })

    it('email ya miembro → 409', async () => {
      mockGetSession.mockResolvedValue({ userId: adminId, token: 'tok' })
      const res = await postInvite(
        new Request('http://localhost/api/workspaces/x/members/invite', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: `mem-member-${memberId.slice(0, 8)}@example.com`, role: 'member' }),
        }),
        { params: Promise.resolve({ id: wsId }) }
      )
      expect(res.status).toBe(409)
    })

    it('email es el owner → 409', async () => {
      mockGetSession.mockResolvedValue({ userId: adminId, token: 'tok' })
      const res = await postInvite(
        new Request('http://localhost/api/workspaces/x/members/invite', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: `mem-owner-${ownerId.slice(0, 8)}@example.com`, role: 'member' }),
        }),
        { params: Promise.resolve({ id: wsId }) }
      )
      expect(res.status).toBe(409)
    })

    it('email inválido → 400', async () => {
      mockGetSession.mockResolvedValue({ userId: adminId, token: 'tok' })
      const res = await postInvite(
        new Request('http://localhost/api/workspaces/x/members/invite', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'not-an-email', role: 'member' }),
        }),
        { params: Promise.resolve({ id: wsId }) }
      )
      expect(res.status).toBe(400)
    })
  })

  // ============================================================
  // PATCH /members/[userId]
  // ============================================================

  describe('PATCH /api/workspaces/[id]/members/[userId]', () => {
    it('401 sin sesión', async () => {
      mockGetSession.mockResolvedValue(null)
      const res = await patchMember(
        new Request('http://localhost/api/workspaces/x/members/y', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ role: 'admin' }),
        }),
        { params: Promise.resolve({ id: wsId, userId: memberId }) }
      )
      expect(res.status).toBe(401)
    })

    it('viewer no puede cambiar rol → 403', async () => {
      mockGetSession.mockResolvedValue({ userId: viewerId, token: 'tok' })
      const res = await patchMember(
        new Request('http://localhost/api/workspaces/x/members/y', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ role: 'admin' }),
        }),
        { params: Promise.resolve({ id: wsId, userId: memberId }) }
      )
      expect(res.status).toBe(403)
    })

    it('owner cambia rol de member → 200', async () => {
      mockGetSession.mockResolvedValue({ userId: ownerId, token: 'tok' })
      const res = await patchMember(
        new Request('http://localhost/api/workspaces/x/members/y', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ role: 'admin' }),
        }),
        { params: Promise.resolve({ id: wsId, userId: memberId }) }
      )
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.member.role).toBe('admin')

      // restaurar
      await db.update(workspaceMembers).set({ role: 'member' }).where(
        and(eq(workspaceMembers.workspaceId, wsId), eq(workspaceMembers.userId, memberId))
      )
    })

    it('admin no puede cambiar rol de otro admin → 403', async () => {
      // crear otro admin
      const otherAdminId = uuidv4()
      await db.insert(users).values({
        id: otherAdminId,
        email: `mem-admin2-${otherAdminId.slice(0, 8)}@example.com`,
        passwordHash: 'hash',
        displayName: 'Admin 2',
        emailVerified: true,
      })
      await db.insert(workspaceMembers).values({
        id: uuidv4(),
        workspaceId: wsId,
        userId: otherAdminId,
        role: 'admin',
      })

      mockGetSession.mockResolvedValue({ userId: adminId, token: 'tok' })
      const res = await patchMember(
        new Request('http://localhost/api/workspaces/x/members/y', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ role: 'member' }),
        }),
        { params: Promise.resolve({ id: wsId, userId: otherAdminId }) }
      )
      expect(res.status).toBe(403)

      await cleanupUser(otherAdminId)
    })

    it('no puedes modificar al propietario → 400', async () => {
      mockGetSession.mockResolvedValue({ userId: ownerId, token: 'tok' })
      const res = await patchMember(
        new Request('http://localhost/api/workspaces/x/members/y', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ role: 'member' }),
        }),
        { params: Promise.resolve({ id: wsId, userId: ownerId }) }
      )
      expect(res.status).toBe(400)
    })

    it('no puedes modificarte a ti mismo → 400', async () => {
      mockGetSession.mockResolvedValue({ userId: adminId, token: 'tok' })
      const res = await patchMember(
        new Request('http://localhost/api/workspaces/x/members/y', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ role: 'member' }),
        }),
        { params: Promise.resolve({ id: wsId, userId: adminId }) }
      )
      expect(res.status).toBe(400)
    })

    it('target inexistente en workspace → 404', async () => {
      mockGetSession.mockResolvedValue({ userId: ownerId, token: 'tok' })
      const res = await patchMember(
        new Request('http://localhost/api/workspaces/x/members/y', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ role: 'member' }),
        }),
        { params: Promise.resolve({ id: wsId, userId: outsiderId }) }
      )
      expect(res.status).toBe(404)
    })

    it('PATCH role=owner → 400 (no asignable vía PATCH)', async () => {
      mockGetSession.mockResolvedValue({ userId: ownerId, token: 'tok' })
      const res = await patchMember(
        new Request('http://localhost/api/workspaces/x/members/y', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ role: 'owner' }),
        }),
        { params: Promise.resolve({ id: wsId, userId: memberId }) }
      )
      expect(res.status).toBe(400)
    })
  })

  // ============================================================
  // DELETE /members/[userId]
  // ============================================================

  describe('DELETE /api/workspaces/[id]/members/[userId]', () => {
    it('401 sin sesión', async () => {
      mockGetSession.mockResolvedValue(null)
      const res = await deleteMember(
        new Request('http://localhost/api/workspaces/x/members/y', { method: 'DELETE' }),
        { params: Promise.resolve({ id: wsId, userId: memberId }) }
      )
      expect(res.status).toBe(401)
    })

    it('viewer no puede revocar → 403', async () => {
      mockGetSession.mockResolvedValue({ userId: viewerId, token: 'tok' })
      const res = await deleteMember(
        new Request('http://localhost/api/workspaces/x/members/y', { method: 'DELETE' }),
        { params: Promise.resolve({ id: wsId, userId: memberId }) }
      )
      expect(res.status).toBe(403)
    })

    it('owner revoca a un miembro → 204', async () => {
      // crear un miembro temporal
      const tempUserId = uuidv4()
      await db.insert(users).values({
        id: tempUserId,
        email: `mem-temp-${tempUserId.slice(0, 8)}@example.com`,
        passwordHash: 'hash',
        displayName: 'Temp Member',
        emailVerified: true,
      })
      await db.insert(workspaceMembers).values({
        id: uuidv4(),
        workspaceId: wsId,
        userId: tempUserId,
        role: 'viewer',
      })

      mockGetSession.mockResolvedValue({ userId: ownerId, token: 'tok' })
      const res = await deleteMember(
        new Request('http://localhost/api/workspaces/x/members/y', { method: 'DELETE' }),
        { params: Promise.resolve({ id: wsId, userId: tempUserId }) }
      )
      expect(res.status).toBe(204)

      // verificar que se eliminó
      const after = await db.select().from(workspaceMembers).where(
        and(eq(workspaceMembers.workspaceId, wsId), eq(workspaceMembers.userId, tempUserId))
      ).get()
      expect(after).toBeUndefined()

      await cleanupUser(tempUserId)
    })

    it('no puedes revocar al propietario → 400', async () => {
      mockGetSession.mockResolvedValue({ userId: ownerId, token: 'tok' })
      const res = await deleteMember(
        new Request('http://localhost/api/workspaces/x/members/y', { method: 'DELETE' }),
        { params: Promise.resolve({ id: wsId, userId: ownerId }) }
      )
      expect(res.status).toBe(400)
    })

    it('no puedes revocarte a ti mismo → 400', async () => {
      mockGetSession.mockResolvedValue({ userId: adminId, token: 'tok' })
      const res = await deleteMember(
        new Request('http://localhost/api/workspaces/x/members/y', { method: 'DELETE' }),
        { params: Promise.resolve({ id: wsId, userId: adminId }) }
      )
      expect(res.status).toBe(400)
    })

    it('target inexistente → 404', async () => {
      mockGetSession.mockResolvedValue({ userId: ownerId, token: 'tok' })
      const res = await deleteMember(
        new Request('http://localhost/api/workspaces/x/members/y', { method: 'DELETE' }),
        { params: Promise.resolve({ id: wsId, userId: outsiderId }) }
      )
      expect(res.status).toBe(404)
    })
  })
})
