import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/lib/db'
import { users, workspaces, workspaceMembers, invitations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

// Mock getSession para probar rutas autenticadas
vi.mock('@/lib/auth/session', () => ({
  getSession: vi.fn(),
}))

import { getSession } from '@/lib/auth/session'
import { POST as postAccept } from '@/app/api/invitations/[token]/accept/route'

const mockGetSession = getSession as unknown as ReturnType<typeof vi.fn>

// ============================================================
// Setup — workspace + owner + invitado
// ============================================================

const ownerId = uuidv4()
const inviteeId = uuidv4()
const otherUserId = uuidv4()
const wsId = uuidv4()
const wsSlug = `inv-accept-${wsId.slice(0, 8)}`

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

/** Crea una invitación válida (no expirada, sin acceptedAt) y devuelve su token. */
async function createValidInvitation(email: string, role: 'admin' | 'member' | 'viewer' = 'member'): Promise<string> {
  const token = uuidv4()
  await db.insert(invitations).values({
    id: uuidv4(),
    workspaceId: wsId,
    email,
    role,
    token,
    invitedBy: ownerId,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  })
  return token
}

describe('POST /api/invitations/[token]/accept', () => {
  beforeAll(async () => {
    await db.insert(users).values({
      id: ownerId,
      email: `inv-owner-${ownerId.slice(0, 8)}@example.com`,
      passwordHash: 'hash',
      displayName: 'Inv Owner',
      emailVerified: true,
    })
    await db.insert(users).values({
      id: inviteeId,
      email: `inv-invitee-${inviteeId.slice(0, 8)}@example.com`,
      passwordHash: 'hash',
      displayName: 'Inv Invitee',
      emailVerified: true,
    })
    await db.insert(users).values({
      id: otherUserId,
      email: `inv-other-${otherUserId.slice(0, 8)}@example.com`,
      passwordHash: 'hash',
      displayName: 'Inv Other',
      emailVerified: true,
    })
    createdUserIds.push(ownerId, inviteeId, otherUserId)

    await db.insert(workspaces).values({
      id: wsId,
      ownerId,
      name: 'Invite Accept WS',
      slug: wsSlug,
    })
    createdWorkspaceIds.push(wsId)
  })

  afterAll(async () => {
    for (const wId of createdWorkspaceIds) await cleanupWorkspace(wId)
    for (const uId of createdUserIds) await cleanupUser(uId)
  })

  beforeEach(() => {
    mockGetSession.mockReset()
  })

  it('401 sin sesión', async () => {
    mockGetSession.mockResolvedValue(null)
    const res = await postAccept(
      new Request('http://localhost/api/invitations/x/accept', { method: 'POST' }),
      { params: { token: 'any-token' } }
    )
    expect(res.status).toBe(401)
  })

  it('token no existe → 404', async () => {
    mockGetSession.mockResolvedValue({ userId: inviteeId, token: 'tok' })
    const res = await postAccept(
      new Request('http://localhost/api/invitations/x/accept', { method: 'POST' }),
      { params: { token: 'fake-token' } }
    )
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('Invitación no encontrada')
  })

  it('invitación expirada → 410', async () => {
    const token = uuidv4()
    await db.insert(invitations).values({
      id: uuidv4(),
      workspaceId: wsId,
      email: `inv-invitee-${inviteeId.slice(0, 8)}@example.com`,
      role: 'member',
      token,
      invitedBy: ownerId,
      expiresAt: new Date(Date.now() - 1000),
    })

    mockGetSession.mockResolvedValue({ userId: inviteeId, token: 'tok' })
    const res = await postAccept(
      new Request('http://localhost/api/invitations/x/accept', { method: 'POST' }),
      { params: { token } }
    )
    expect(res.status).toBe(410)
    const json = await res.json()
    expect(json.error).toBe('La invitación ha expirado')

    await db.delete(invitations).where(eq(invitations.token, token))
  })

  it('invitación ya utilizada → 410', async () => {
    const token = uuidv4()
    await db.insert(invitations).values({
      id: uuidv4(),
      workspaceId: wsId,
      email: `inv-invitee-${inviteeId.slice(0, 8)}@example.com`,
      role: 'member',
      token,
      invitedBy: ownerId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      acceptedAt: new Date(),
    })

    mockGetSession.mockResolvedValue({ userId: inviteeId, token: 'tok' })
    const res = await postAccept(
      new Request('http://localhost/api/invitations/x/accept', { method: 'POST' }),
      { params: { token } }
    )
    expect(res.status).toBe(410)
    const json = await res.json()
    expect(json.error).toBe('La invitación ya fue utilizada')

    await db.delete(invitations).where(eq(invitations.token, token))
  })

  it('email de sesión ≠ invitation.email → 403', async () => {
    const token = await createValidInvitation(`inv-other-${otherUserId.slice(0, 8)}@example.com`)

    // inviteeId intenta aceptar una invitación dirigida a otherUserId
    mockGetSession.mockResolvedValue({ userId: inviteeId, token: 'tok' })
    const res = await postAccept(
      new Request('http://localhost/api/invitations/x/accept', { method: 'POST' }),
      { params: { token } }
    )
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toBe('Esta invitación es para otra cuenta')

    await db.delete(invitations).where(eq(invitations.token, token))
  })

  it('ya miembro → 409', async () => {
    // inviteeId ya es miembro
    await db.insert(workspaceMembers).values({
      id: uuidv4(),
      workspaceId: wsId,
      userId: inviteeId,
      role: 'viewer',
    })

    const token = await createValidInvitation(`inv-invitee-${inviteeId.slice(0, 8)}@example.com`)

    mockGetSession.mockResolvedValue({ userId: inviteeId, token: 'tok' })
    const res = await postAccept(
      new Request('http://localhost/api/invitations/x/accept', { method: 'POST' }),
      { params: { token } }
    )
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toBe('Ya eres miembro de este workspace')

    await db.delete(invitations).where(eq(invitations.token, token))
    await db.delete(workspaceMembers).where(
      and(eq(workspaceMembers.workspaceId, wsId), eq(workspaceMembers.userId, inviteeId))
    )
  })

  it('owner del workspace aceptando su propia invitación → 409', async () => {
    const token = await createValidInvitation(`inv-owner-${ownerId.slice(0, 8)}@example.com`)

    mockGetSession.mockResolvedValue({ userId: ownerId, token: 'tok' })
    const res = await postAccept(
      new Request('http://localhost/api/invitations/x/accept', { method: 'POST' }),
      { params: { token } }
    )
    expect(res.status).toBe(409)

    await db.delete(invitations).where(eq(invitations.token, token))
  })

  it('OK → 200 con workspace + tx setea acceptedAt y crea member con rol heredado', async () => {
    const token = await createValidInvitation(`inv-invitee-${inviteeId.slice(0, 8)}@example.com`, 'admin')

    mockGetSession.mockResolvedValue({ userId: inviteeId, token: 'tok' })
    const res = await postAccept(
      new Request('http://localhost/api/invitations/x/accept', { method: 'POST' }),
      { params: { token } }
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.workspace.id).toBe(wsId)
    expect(json.workspace.name).toBe('Invite Accept WS')
    expect(json.workspace.slug).toBe(wsSlug)

    // acceptedAt seteado explícitamente en la tx
    const inv = await db.select().from(invitations).where(eq(invitations.token, token)).get()
    expect(inv!.acceptedAt).not.toBeNull()

    // member creado con rol heredado de la invitación (admin, nunca owner)
    const member = await db.select().from(workspaceMembers).where(
      and(eq(workspaceMembers.workspaceId, wsId), eq(workspaceMembers.userId, inviteeId))
    ).get()
    expect(member).toBeDefined()
    expect(member!.role).toBe('admin')
    expect(member!.invitedBy).toBe(ownerId)

    // re-aceptar → 410 (ya utilizada)
    const res2 = await postAccept(
      new Request('http://localhost/api/invitations/x/accept', { method: 'POST' }),
      { params: { token } }
    )
    expect(res2.status).toBe(410)

    // cleanup
    await db.delete(workspaceMembers).where(
      and(eq(workspaceMembers.workspaceId, wsId), eq(workspaceMembers.userId, inviteeId))
    )
    await db.delete(invitations).where(eq(invitations.token, token))
  })
})