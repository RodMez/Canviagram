import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/lib/db'
import { users, workspaces, workspaceMembers, invitations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import * as workspaceAdmin from '@/lib/workspace-admin'

// Mock sendInvitation para no enviar emails reales en tests
vi.mock('@/lib/email/brevo', () => ({
  sendInvitation: vi.fn().mockResolvedValue(undefined),
}))

import { sendInvitation } from '@/lib/email/brevo'

// ============================================================
// Setup global — IDs únicos por run
// ============================================================

const ownerId = uuidv4()
const adminId = uuidv4()
const memberId = uuidv4()
const viewerId = uuidv4()
const outsiderId = uuidv4()
const wsId = uuidv4()
const wsSlug = `test-admin-${wsId.slice(0, 8)}`

/** IDs de workspaces creados por tests, para cleanup */
const createdWorkspaceIds: string[] = []
/** IDs de usuarios creados por tests, para cleanup */
const createdUserIds: string[] = []

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

describe('workspace-admin service', () => {
  beforeAll(async () => {
    // Crear usuarios
    const userIds = [ownerId, adminId, memberId, viewerId]
    const roles = ['owner', 'admin', 'member', 'viewer']
    for (let i = 0; i < userIds.length; i++) {
      await db.insert(users).values({
        id: userIds[i],
        email: `wsa-${roles[i]}-${userIds[i].slice(0, 8)}@example.com`,
        passwordHash: 'hash',
        displayName: `WSA ${roles[i]}`,
        emailVerified: true,
      })
    }

    await db.insert(users).values({
      id: outsiderId,
      email: `wsa-outsider-${outsiderId.slice(0, 8)}@example.com`,
      passwordHash: 'hash',
      displayName: 'WSA Outsider',
      emailVerified: true,
    })
    createdUserIds.push(ownerId, adminId, memberId, viewerId, outsiderId)

    // Crear workspace
    await db.insert(workspaces).values({
      id: wsId,
      ownerId,
      name: 'WSA Test',
      slug: wsSlug,
    })
    createdWorkspaceIds.push(wsId)

    // Crear memberships (excluye owner — ya tiene acceso por ownerId)
    await db.insert(workspaceMembers).values([
      { id: uuidv4(), workspaceId: wsId, userId: adminId, role: 'admin' },
      { id: uuidv4(), workspaceId: wsId, userId: memberId, role: 'member' },
      { id: uuidv4(), workspaceId: wsId, userId: viewerId, role: 'viewer' },
    ])
  })

  afterAll(async () => {
    // Cleanup en orden inverso de dependencias FK
    for (const wId of createdWorkspaceIds) {
      await cleanupWorkspace(wId)
    }
    for (const uId of createdUserIds) {
      await cleanupUser(uId)
    }
  })

  // ============================================================
  // PATCH workspace
  // ============================================================

  describe('updateWorkspace', () => {
    it('owner puede cambiar name', async () => {
      const { workspace } = await workspaceAdmin.updateWorkspace(wsId, ownerId, { name: 'Nuevo Nombre' })
      expect(workspace.name).toBe('Nuevo Nombre')
      await db.update(workspaces).set({ name: 'WSA Test' }).where(eq(workspaces.id, wsId))
    })

    it('owner puede cambiar slug', async () => {
      const newSlug = `wsa-new-${Date.now()}`
      const { workspace } = await workspaceAdmin.updateWorkspace(wsId, ownerId, { slug: newSlug })
      expect(workspace.slug).toBe(newSlug)
      await db.update(workspaces).set({ slug: wsSlug }).where(eq(workspaces.id, wsId))
    })

    it('slug duplicado → ConflictError', async () => {
      const otherWsId = uuidv4()
      const otherSlug = `wsa-other-${otherWsId.slice(0, 8)}`
      await db.insert(workspaces).values({
        id: otherWsId,
        ownerId,
        name: 'Other WS',
        slug: otherSlug,
      })
      createdWorkspaceIds.push(otherWsId)

      await expect(
        workspaceAdmin.updateWorkspace(wsId, ownerId, { slug: otherSlug })
      ).rejects.toThrow()
    })

    it('viewer no puede actualizar → ForbiddenError', async () => {
      await expect(
        workspaceAdmin.updateWorkspace(wsId, viewerId, { name: 'Hack' })
      ).rejects.toThrow()
    })

    it('outsider no puede actualizar → ForbiddenError', async () => {
      await expect(
        workspaceAdmin.updateWorkspace(wsId, outsiderId, { name: 'Hack' })
      ).rejects.toThrow()
    })

    it('campos vacíos → ValidationError', async () => {
      await expect(
        workspaceAdmin.updateWorkspace(wsId, ownerId, {})
      ).rejects.toThrow()
    })

    it('workspace inexistente → NotFoundError', async () => {
      await expect(
        workspaceAdmin.updateWorkspace('ws-fake', ownerId, { name: 'X' })
      ).rejects.toThrow()
    })
  })

  // ============================================================
  // DELETE workspace
  // ============================================================

  describe('deleteWorkspace', () => {
    it('owner puede eliminar con confirmSlug correcto', async () => {
      const delId = uuidv4()
      const delSlug = `del-${delId.slice(0, 8)}`
      await db.insert(workspaces).values({
        id: delId,
        ownerId,
        name: 'Delete Me',
        slug: delSlug,
      })

      await workspaceAdmin.deleteWorkspace(delId, ownerId, delSlug)
      const gone = await db.select().from(workspaces).where(eq(workspaces.id, delId)).get()
      expect(gone).toBeUndefined()
    })

    it('confirmSlug incorrecto → ValidationError', async () => {
      const delId = uuidv4()
      const delSlug = `del2-${delId.slice(0, 8)}`
      await db.insert(workspaces).values({
        id: delId,
        ownerId,
        name: 'Delete Me 2',
        slug: delSlug,
      })
      createdWorkspaceIds.push(delId)

      await expect(
        workspaceAdmin.deleteWorkspace(delId, ownerId, 'wrong-slug')
      ).rejects.toThrow()
    })

    it('admin no puede eliminar → ForbiddenError', async () => {
      const delId = uuidv4()
      const delSlug = `del3-${delId.slice(0, 8)}`
      await db.insert(workspaces).values({
        id: delId,
        ownerId,
        name: 'Delete Me 3',
        slug: delSlug,
      })
      createdWorkspaceIds.push(delId)

      await expect(
        workspaceAdmin.deleteWorkspace(delId, adminId, delSlug)
      ).rejects.toThrow()
    })

    it('workspace inexistente → NotFoundError', async () => {
      await expect(
        workspaceAdmin.deleteWorkspace('ws-fake', ownerId, 'x')
      ).rejects.toThrow()
    })
  })

  // ============================================================
  // Hierarchy rules §2
  // ============================================================

  describe('hierarchy rules §2', () => {
    const targetAdminId = uuidv4()

    beforeAll(async () => {
      await db.insert(users).values({
        id: targetAdminId,
        email: `wsa-target-${targetAdminId.slice(0, 8)}@example.com`,
        passwordHash: 'hash',
        displayName: 'Target Admin',
        emailVerified: true,
      })
      createdUserIds.push(targetAdminId)

      // Agregar como admin del workspace
      await db.insert(workspaceMembers).values({
        id: uuidv4(),
        workspaceId: wsId,
        userId: targetAdminId,
        role: 'admin',
      })
    })

    it('admin no puede cambiar rol de otro admin (regla 5)', async () => {
      await expect(
        workspaceAdmin.updateMemberRole(wsId, adminId, targetAdminId, { role: 'member' })
      ).rejects.toThrow()
    })

    it('owner puede cambiar rol de admin', async () => {
      const { member } = await workspaceAdmin.updateMemberRole(wsId, ownerId, targetAdminId, { role: 'member' })
      expect(member.role).toBe('member')
      // restaurar
      await db.update(workspaceMembers).set({ role: 'admin' }).where(
        and(eq(workspaceMembers.workspaceId, wsId), eq(workspaceMembers.userId, targetAdminId))
      )
    })

    it('no puedes modificar al propietario', async () => {
      await expect(
        workspaceAdmin.updateMemberRole(wsId, ownerId, ownerId, { role: 'member' })
      ).rejects.toThrow()
    })

    it('no puedes revocarte a ti mismo', async () => {
      await expect(
        workspaceAdmin.revokeMember(wsId, adminId, adminId)
      ).rejects.toThrow()
    })

    it('admin no puede revocar a otro admin', async () => {
      await expect(
        workspaceAdmin.revokeMember(wsId, adminId, targetAdminId)
      ).rejects.toThrow()
    })

    it('member no puede cambiar roles (rango insuficiente)', async () => {
      await expect(
        workspaceAdmin.updateMemberRole(wsId, memberId, viewerId, { role: 'admin' })
      ).rejects.toThrow()
    })

    it('member no puede revocar (rango insuficiente)', async () => {
      await expect(
        workspaceAdmin.revokeMember(wsId, memberId, viewerId)
      ).rejects.toThrow()
    })

    it('owner puede revocar a un miembro', async () => {
      const tempUserId = uuidv4()
      await db.insert(users).values({
        id: tempUserId,
        email: `wsa-temp-${tempUserId.slice(0, 8)}@example.com`,
        passwordHash: 'hash',
        displayName: 'Temp',
        emailVerified: true,
      })
      await db.insert(workspaceMembers).values({
        id: uuidv4(),
        workspaceId: wsId,
        userId: tempUserId,
        role: 'viewer',
      })

      await workspaceAdmin.revokeMember(wsId, ownerId, tempUserId)

      const after = await db.select().from(workspaceMembers).where(
        and(eq(workspaceMembers.workspaceId, wsId), eq(workspaceMembers.userId, tempUserId))
      ).get()
      expect(after).toBeUndefined()

      await cleanupUser(tempUserId)
    })

    it('PATCH role=owner → ValidationError (no asignable vía PATCH)', async () => {
      await expect(
        workspaceAdmin.updateMemberRole(wsId, ownerId, memberId, { role: 'owner' })
      ).rejects.toThrow()
    })

    it('target inexistente en workspace → NotFoundError', async () => {
      await expect(
        workspaceAdmin.updateMemberRole(wsId, ownerId, outsiderId, { role: 'member' })
      ).rejects.toThrow()
    })

    it('revoke target inexistente → NotFoundError', async () => {
      await expect(
        workspaceAdmin.revokeMember(wsId, ownerId, outsiderId)
      ).rejects.toThrow()
    })
  })

  // ============================================================
  // listMembersMeta
  // ============================================================

  describe('listMembersMeta', () => {
    it('owner ve owner + members', async () => {
      const { members, invitations: invs } = await workspaceAdmin.listMembersMeta(wsId, ownerId)
      expect(members.length).toBeGreaterThanOrEqual(4) // owner + admin + targetAdmin + member + viewer
      const ownerEntry = members.find((m) => m.isOwner)
      expect(ownerEntry).toBeDefined()
      expect(ownerEntry!.userId).toBe(ownerId)
      expect(Array.isArray(invs)).toBe(true)
    })

    it('viewer puede leer', async () => {
      const { members } = await workspaceAdmin.listMembersMeta(wsId, viewerId)
      expect(members.length).toBeGreaterThanOrEqual(4)
    })

    it('outsider no puede leer → ForbiddenError', async () => {
      await expect(
        workspaceAdmin.listMembersMeta(wsId, outsiderId)
      ).rejects.toThrow()
    })
  })

  // ============================================================
  // inviteMember
  // ============================================================

  describe('inviteMember', () => {
    it('admin puede invitar → created', async () => {
      const inviteEmail = `invite-${Date.now()}@example.com`
      const { invitation, status } = await workspaceAdmin.inviteMember(wsId, adminId, {
        email: inviteEmail,
        role: 'member',
      })
      expect(status).toBe('created')
      expect(invitation.email).toBe(inviteEmail)
      expect(invitation.role).toBe('member')
      expect(sendInvitation).toHaveBeenCalled()

      await db.delete(invitations).where(
        and(eq(invitations.workspaceId, wsId), eq(invitations.email, inviteEmail))
      )
    })

    it('idempotente: re-invitar pendiente → resent', async () => {
      const inviteEmail = `idem-${Date.now()}@example.com`
      const first = await workspaceAdmin.inviteMember(wsId, adminId, {
        email: inviteEmail,
        role: 'viewer',
      })
      expect(first.status).toBe('created')

      const second = await workspaceAdmin.inviteMember(wsId, adminId, {
        email: inviteEmail,
        role: 'viewer',
      })
      expect(second.status).toBe('resent')
      expect(second.invitation.token).toBe(first.invitation.token)

      await db.delete(invitations).where(
        and(eq(invitations.workspaceId, wsId), eq(invitations.email, inviteEmail))
      )
    })

    it('email ya miembro → ConflictError', async () => {
      await expect(
        workspaceAdmin.inviteMember(wsId, adminId, {
          email: `wsa-member-${memberId.slice(0, 8)}@example.com`,
          role: 'member',
        })
      ).rejects.toThrow()
    })

    it('email es el owner → ConflictError', async () => {
      await expect(
        workspaceAdmin.inviteMember(wsId, adminId, {
          email: `wsa-owner-${ownerId.slice(0, 8)}@example.com`,
          role: 'member',
        })
      ).rejects.toThrow()
    })

    it('viewer no puede invitar → ForbiddenError', async () => {
      await expect(
        workspaceAdmin.inviteMember(wsId, viewerId, {
          email: 'nope@example.com',
          role: 'viewer',
        })
      ).rejects.toThrow()
    })
  })

  // ============================================================
  // acceptInvitation
  // ============================================================

  describe('acceptInvitation', () => {
    it('acepta invitación válida → workspace info', async () => {
      const inviteUserId = uuidv4()
      const inviteEmail = `accept-${inviteUserId.slice(0, 8)}@example.com`
      await db.insert(users).values({
        id: inviteUserId,
        email: inviteEmail,
        passwordHash: 'hash',
        displayName: 'Accept User',
        emailVerified: true,
      })

      const token = uuidv4()
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      await db.insert(invitations).values({
        id: uuidv4(),
        workspaceId: wsId,
        email: inviteEmail,
        role: 'member',
        token,
        invitedBy: ownerId,
        expiresAt,
      })

      const result = await workspaceAdmin.acceptInvitation(token, inviteUserId)
      expect(result.workspace.id).toBe(wsId)
      expect(result.workspace.name).toBe('WSA Test')

      // Verificar acceptedAt fue seteado
      const inv = await db.select().from(invitations).where(eq(invitations.token, token)).get()
      expect(inv!.acceptedAt).not.toBeNull()

      // Verificar member fue creado
      const member = await db.select().from(workspaceMembers).where(
        and(eq(workspaceMembers.workspaceId, wsId), eq(workspaceMembers.userId, inviteUserId))
      ).get()
      expect(member).toBeDefined()
      expect(member!.role).toBe('member')

      // cleanup
      await db.delete(workspaceMembers).where(
        and(eq(workspaceMembers.workspaceId, wsId), eq(workspaceMembers.userId, inviteUserId))
      )
      await db.delete(invitations).where(eq(invitations.token, token))
      await cleanupUser(inviteUserId)
    })

    it('token no existe → NotFoundError', async () => {
      await expect(
        workspaceAdmin.acceptInvitation('fake-token', ownerId)
      ).rejects.toThrow()
    })

    it('invitación expirada → GoneError', async () => {
      const token = uuidv4()
      const expiresAt = new Date(Date.now() - 1000)
      await db.insert(invitations).values({
        id: uuidv4(),
        workspaceId: wsId,
        email: 'expired@example.com',
        role: 'member',
        token,
        invitedBy: ownerId,
        expiresAt,
      })

      try {
        await workspaceAdmin.acceptInvitation(token, ownerId)
        expect.unreachable('debería lanzar GoneError')
      } catch (e) {
        expect((e as Error).name).toBe('GoneError')
        expect((e as Error).message).toBe('La invitación ha expirado')
      }

      await db.delete(invitations).where(eq(invitations.token, token))
    })

    it('invitación ya utilizada → GoneError', async () => {
      const token = uuidv4()
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      await db.insert(invitations).values({
        id: uuidv4(),
        workspaceId: wsId,
        email: 'used@example.com',
        role: 'member',
        token,
        invitedBy: ownerId,
        expiresAt,
        acceptedAt: new Date(),
      })

      try {
        await workspaceAdmin.acceptInvitation(token, ownerId)
        expect.unreachable('debería lanzar GoneError')
      } catch (e) {
        expect((e as Error).name).toBe('GoneError')
        expect((e as Error).message).toBe('La invitación ya fue utilizada')
      }

      await db.delete(invitations).where(eq(invitations.token, token))
    })

    it('email de sesión ≠ invitation.email → ForbiddenError', async () => {
      const token = uuidv4()
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      await db.insert(invitations).values({
        id: uuidv4(),
        workspaceId: wsId,
        email: 'other-person@example.com',
        role: 'member',
        token,
        invitedBy: ownerId,
        expiresAt,
      })

      await expect(
        workspaceAdmin.acceptInvitation(token, ownerId)
      ).rejects.toThrow()

      await db.delete(invitations).where(eq(invitations.token, token))
    })
  })

  // ============================================================
  // unlinkTelegram
  // ============================================================

  describe('unlinkTelegram', () => {
    it('admin puede unlink', async () => {
      await expect(
        workspaceAdmin.unlinkTelegram(wsId, adminId)
      ).resolves.toBeUndefined()
    })

    it('viewer no puede unlink → ForbiddenError', async () => {
      await expect(
        workspaceAdmin.unlinkTelegram(wsId, viewerId)
      ).rejects.toThrow()
    })

    it('outsider no puede unlink → ForbiddenError', async () => {
      await expect(
        workspaceAdmin.unlinkTelegram(wsId, outsiderId)
      ).rejects.toThrow()
    })
  })
})
