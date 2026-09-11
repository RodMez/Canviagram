import { db } from '@/lib/db'
import { workspaces, workspaceMembers, invitations, users, telegramChats } from '@/lib/db/schema'
import { eq, and, ne, lt, isNull, desc } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { ROLE_RANK, assertWorkspaceAccess, assertCanAdmin } from '@/lib/auth/workspace-access'
import { sendInvitation } from '@/lib/email/brevo'
import { hashToken } from '@/lib/auth/tokens'
import { ConflictError, ValidationError, NotFoundError, ForbiddenError, GoneError } from '@/lib/errors'
import { updateWorkspaceSchema, inviteSchema, updateMemberRoleSchema } from '@/lib/validators/workspace'
import { deleteBindingsByWorkspace } from '@/lib/telegram/chats'

export const INVITE_TTL_DAYS = 7

// ============================================================
// Helpers internos
// ============================================================

function handleZodError(error: unknown): never {
  if (error instanceof Error && 'issues' in error) {
    const zodError = error as { issues: unknown; message: string }
    throw new ValidationError(zodError.message, zodError.issues)
  }
  throw error as never
}

function getRank(role: string): number {
  return ROLE_RANK[role] ?? -1
}

/**
 * Resuelve el rango efectivo del actor en un workspace:
 * - Si es ownerId → 'owner'
 * - Si tiene fila member → su role
 * - Si no → null (sin acceso)
 */
function resolveActorRank(
  workspace: typeof workspaces.$inferSelect,
  userId: string,
  memberRow: (typeof workspaceMembers.$inferSelect) | null
): string | null {
  if (workspace.ownerId === userId) return 'owner'
  return memberRow?.role ?? null
}

/**
 * Valida las reglas de jerarquía §2 para updateMemberRole y revokeMember.
 * Lanza ValidationError/ForbiddenError según el caso.
 */
function assertHierarchyRules(
  actorRank: string,
  targetUserId: string,
  workspace: typeof workspaces.$inferSelect,
  userId: string,
  targetRank: string | null,
  action: 'PATCH' | 'DELETE'
): void {
  // Regla 2: La fila del owner no se toca
  if (workspace.ownerId === targetUserId) {
    throw new ValidationError(
      action === 'DELETE'
        ? 'No puedes revocar al propietario'
        : 'No puedes modificar al propietario'
    )
  }

  // Regla 3: Autorevocación/autodegrada
  if (targetUserId === userId) {
    throw new ValidationError(
      action === 'DELETE'
        ? 'No puedes revocarte a ti mismo'
        : 'No puedes modificarte a ti mismo'
    )
  }

  // Regla 1: Target no puede tener rango > actor
  if (targetRank !== null && getRank(targetRank) > getRank(actorRank)) {
    throw new ForbiddenError('No tienes permisos para modificar a este miembro')
  }

  // Regla 5: Un admin no gestiona a otro admin (rango igual bloqueado por regla 1 con >)
  if (targetRank !== null && getRank(targetRank) === getRank(actorRank)) {
    throw new ForbiddenError('No tienes permisos para modificar a este miembro')
  }
}

// ============================================================
// PATCH workspace
// ============================================================

export async function updateWorkspace(
  workspaceId: string,
  userId: string,
  input: unknown
): Promise<{ workspace: typeof workspaces.$inferSelect }> {
  await assertCanAdmin(workspaceId, userId)

  let parsed: ReturnType<typeof updateWorkspaceSchema.parse>
  try {
    parsed = updateWorkspaceSchema.parse(input)
  } catch (e) {
    handleZodError(e)
  }

  const existing = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .get()

  if (!existing) {
    throw new NotFoundError('Workspace no encontrado')
  }

  // Verificar slug único si se está cambiando
  if (parsed!.slug && parsed!.slug !== existing.slug) {
    const slugTaken = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.slug, parsed!.slug!), ne(workspaces.id, workspaceId)))
      .get()

    if (slugTaken) {
      throw new ConflictError('El slug ya está en uso')
    }
  }

  const now = new Date()
  const updateData: Record<string, unknown> = { updatedAt: now }
  if (parsed!.name !== undefined) updateData.name = parsed!.name
  if (parsed!.slug !== undefined) updateData.slug = parsed!.slug
  if (parsed!.description !== undefined) updateData.description = parsed!.description

  const [updated] = await db
    .update(workspaces)
    .set(updateData as never)
    .where(eq(workspaces.id, workspaceId))
    .returning()

  return { workspace: updated ?? { ...existing, ...updateData } }
}

// ============================================================
// DELETE workspace (owner only)
// ============================================================

export async function deleteWorkspace(
  workspaceId: string,
  userId: string,
  confirmSlug: string
): Promise<void> {
  const workspace = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .get()

  if (!workspace) {
    throw new NotFoundError('Workspace no encontrado')
  }

  if (workspace.ownerId !== userId) {
    throw new ForbiddenError('Solo el propietario puede eliminar el workspace')
  }

  if (confirmSlug !== workspace.slug) {
    throw new ValidationError('El slug de confirmación no coincide')
  }

  // Un solo DELETE; cascade FK cubre nodes/edges/workspaceMembers/invitations/telegramChats
  db.transaction((tx) => {
    tx.delete(workspaces).where(eq(workspaces.id, workspaceId)).run()
  })
}

// ============================================================
// List members + invitations
// ============================================================

export async function listMembersMeta(
  workspaceId: string,
  userId: string
): Promise<{
  members: Array<{
    userId: string
    displayName: string
    email: string
    role: string
    joinedAt: Date | null
    isOwner: boolean
  }>
  invitations: Array<{
    id: string
    email: string
    role: string
    expiresAt: Date
    acceptedAt: Date | null
    expired: boolean
  }>
}> {
  await assertWorkspaceAccess(workspaceId, userId, 'viewer')

  const workspace = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .get()

  if (!workspace) {
    throw new NotFoundError('Workspace no encontrado')
  }

  // Owner: lookup por workspaces.ownerId + users
  const ownerUser = await db
    .select({ displayName: users.displayName, email: users.email })
    .from(users)
    .where(eq(users.id, workspace.ownerId))
    .get()

  const ownerMember = {
    userId: workspace.ownerId,
    displayName: ownerUser?.displayName ?? '',
    email: ownerUser?.email ?? '',
    role: 'owner',
    joinedAt: null,
    isOwner: true as const,
  }

  // Members: LEFT JOIN users con filtro en ON (regla @database-reviewer §4)
  const memberRows = await db
    .select({
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
      joinedAt: workspaceMembers.joinedAt,
      displayName: users.displayName,
      email: users.email,
    })
    .from(workspaceMembers)
    .leftJoin(users, and(eq(workspaceMembers.userId, users.id), isNull(users.deletedAt)))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .all()

  // Excluir owner para no duplicar
  const memberList = memberRows
    .filter((m) => m.userId !== workspace.ownerId)
    .map((m) => ({
      userId: m.userId,
      displayName: m.displayName ?? '',
      email: m.email ?? '',
      role: m.role,
      joinedAt: m.joinedAt,
      isOwner: false as const,
    }))

  const members = [ownerMember, ...memberList]

  // Invitations: pendientes (sin acceptedAt y sin expirar)
  const now = new Date()
  const invitationRows = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.workspaceId, workspaceId),
        isNull(invitations.acceptedAt),
        // expiresAt > now en JS (comparación de timestamps)
      )
    )
    .orderBy(desc(invitations.createdAt))
    .all()

  const invitationList = invitationRows
    .filter((inv) => inv.expiresAt.getTime() > now.getTime())
    .map((inv) => ({
      id: inv.id,
      email: inv.email,
      role: inv.role,
      expiresAt: inv.expiresAt,
      acceptedAt: inv.acceptedAt,
      expired: false,
    }))

  return { members, invitations: invitationList }
}

// ============================================================
// Invite member
// ============================================================

export async function inviteMember(
  workspaceId: string,
  userId: string,
  input: unknown
): Promise<{ invitation: typeof invitations.$inferSelect; status: 'created' | 'resent' }> {
  await assertCanAdmin(workspaceId, userId)

  let parsed: ReturnType<typeof inviteSchema.parse>
  try {
    parsed = inviteSchema.parse(input)
  } catch (e) {
    handleZodError(e)
  }

  const email = parsed!.email.toLowerCase().trim()

  // Verificar que el workspace existe
  const workspace = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .get()

  if (!workspace) {
    throw new NotFoundError('Workspace no encontrado')
  }

  // Verificar que el email no es ya miembro (workspaceMembers)
  const existingMember = await db
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, (await db.select({ id: users.id }).from(users).where(eq(users.email, email)).get())?.id ?? '__none__')
      )
    )
    .get()

  if (existingMember) {
    throw new ConflictError('Este email ya es miembro del workspace')
  }

  // Verificar que el email no es el owner
  const ownerUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .get()

  if (ownerUser && ownerUser.id === workspace.ownerId) {
    throw new ConflictError('Este email ya es miembro del workspace')
  }

  // Idempotencia: si ya hay invitación pendiente same (workspace,email) sin acceptedAt y no expirada → reenviar
  const now = new Date()
  const pendingInvitation = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.workspaceId, workspaceId),
        eq(invitations.email, email),
        isNull(invitations.acceptedAt)
      )
    )
    .get()

  if (pendingInvitation && pendingInvitation.expiresAt.getTime() > now.getTime()) {
    // El token plano ya no es recuperable (solo se guarda su hash) → rotar con uno nuevo
    const newToken = uuidv4()
    db.update(invitations)
      .set({ tokenHash: hashToken(newToken) })
      .where(eq(invitations.id, pendingInvitation.id))
      .run()
    sendInvitation(email, newToken, workspace.name).catch(() => {})
    return { invitation: { ...pendingInvitation, tokenHash: hashToken(newToken) }, status: 'resent' }
  }

  // Crear nueva invitación
  const id = uuidv4()
  const token = uuidv4()
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000)

  const [inserted] = await db
    .insert(invitations)
    .values({
      id,
      workspaceId,
      email,
      role: parsed!.role,
      tokenHash: hashToken(token),
      invitedBy: userId,
      expiresAt,
      createdAt: now,
    })
    .returning()

  // Enviar email (no bloqueante)
  sendInvitation(email, token, workspace.name).catch(() => {})

  return { invitation: inserted ?? { id, workspaceId, email, role: parsed!.role, tokenHash: hashToken(token), invitedBy: userId, expiresAt, acceptedAt: null, createdAt: now }, status: 'created' }
}

// ============================================================
// Update member role
// ============================================================

export async function updateMemberRole(
  workspaceId: string,
  userId: string,
  targetUserId: string,
  input: unknown
): Promise<{ member: typeof workspaceMembers.$inferSelect }> {
  const { role: actorRank, workspace } = await assertCanAdmin(workspaceId, userId)

  let parsed: ReturnType<typeof updateMemberRoleSchema.parse>
  try {
    parsed = updateMemberRoleSchema.parse(input)
  } catch (e) {
    handleZodError(e)
  }

  // Buscar target member row
  const targetMember = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, targetUserId)
      )
    )
    .get()

  const targetRank = targetMember?.role ?? null

  // Reglas de jerarquía §2
  assertHierarchyRules(actorRank, targetUserId, workspace!, userId, targetRank, 'PATCH')

  // Regla 4: role 'owner' solo para el owner real (no se puede asignar vía PATCH a una fila member)
  if (parsed!.role === 'owner') {
    throw new ValidationError('No puedes asignar el rol de propietario a un miembro')
  }

  // Target debe existir como miembro
  if (!targetMember) {
    throw new NotFoundError('Miembro no encontrado')
  }

  const [updated] = await db
    .update(workspaceMembers)
    .set({ role: parsed!.role })
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, targetUserId)
      )
    )
    .returning()

  return { member: updated ?? { ...targetMember, role: parsed!.role } }
}

// ============================================================
// Revoke member
// ============================================================

export async function revokeMember(
  workspaceId: string,
  userId: string,
  targetUserId: string
): Promise<void> {
  const { role: actorRank, workspace } = await assertCanAdmin(workspaceId, userId)

  // Buscar target member row
  const targetMember = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, targetUserId)
      )
    )
    .get()

  const targetRank = targetMember?.role ?? null

  // Reglas de jerarquía §2
  assertHierarchyRules(actorRank, targetUserId, workspace!, userId, targetRank, 'DELETE')

  if (!targetMember) {
    throw new NotFoundError('Miembro no encontrado')
  }

  await db
    .delete(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, targetUserId)
      )
    )
}

// ============================================================
// Accept invitation
// ============================================================

export async function acceptInvitation(
  token: string,
  userId: string
): Promise<{ workspace: { id: string; name: string; slug: string } }> {
  // Buscar invitación por token
  const invitation = await db
    .select()
    .from(invitations)
    .where(eq(invitations.tokenHash, hashToken(token)))
    .get()

  if (!invitation) {
    throw new NotFoundError('Invitación no encontrada')
  }

  const now = new Date()

  // Invitación expirada
  if (invitation.expiresAt.getTime() < now.getTime()) {
    throw new GoneError('La invitación ha expirado')
  }

  // Invitación ya aceptada
  if (invitation.acceptedAt) {
    throw new GoneError('La invitación ya fue utilizada')
  }

  // Verificar email de sesión === invitation.email
  const sessionUser = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .get()

  if (!sessionUser || sessionUser.email !== invitation.email) {
    throw new ForbiddenError('Esta invitación es para otra cuenta')
  }

  // Verificar que ya no es miembro
  const existingMember = await db
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, invitation.workspaceId),
        eq(workspaceMembers.userId, userId)
      )
    )
    .get()

  if (existingMember) {
    throw new ConflictError('Ya eres miembro de este workspace')
  }

  // Verificar que no es el owner
  const workspace = await db
    .select({ ownerId: workspaces.ownerId })
    .from(workspaces)
    .where(eq(workspaces.id, invitation.workspaceId))
    .get()

  if (workspace && workspace.ownerId === userId) {
    throw new ConflictError('Ya eres miembro de este workspace')
  }

  // Transacción: insert workspace_members + update invitations SET acceptedAt
  const memberId = uuidv4()
  const joinedAt = now

  db.transaction((tx) => {
    tx.insert(workspaceMembers)
      .values({
        id: memberId,
        workspaceId: invitation.workspaceId,
        userId,
        role: invitation.role,
        invitedBy: invitation.invitedBy,
        joinedAt,
        createdAt: now,
      })
      .run()

    tx.update(invitations)
      .set({ acceptedAt: now })
      .where(eq(invitations.tokenHash, hashToken(token)))
      .run()
  })

  // Recuperar datos del workspace para la respuesta
  const ws = await db
    .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug })
    .from(workspaces)
    .where(eq(workspaces.id, invitation.workspaceId))
    .get()

  return { workspace: ws! }
}

// ============================================================
// Unlink Telegram
// ============================================================

export async function unlinkTelegram(
  workspaceId: string,
  userId: string
): Promise<void> {
  await assertCanAdmin(workspaceId, userId)
  await deleteBindingsByWorkspace(workspaceId)
}
