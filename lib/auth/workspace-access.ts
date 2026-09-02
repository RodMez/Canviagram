import { db } from '@/lib/db'
import { workspaces, workspaceMembers } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { ForbiddenError, NotFoundError } from '@/lib/errors'

// Roles defined in schema: owner, admin, member, viewer
// ROLE_RANK provides hierarchy for comparison.
// owner > admin > member > viewer
export const ROLE_RANK: Record<string, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
} as const

export type WorkspaceRole = 'viewer' | 'member' | 'admin' | 'owner'

function getRank(role: string): number {
  return ROLE_RANK[role] ?? -1
}

/**
 * Verifica que el workspace existe y que el usuario tiene acceso con el rol mínimo requerido.
 * - Si el workspace no existe => NotFoundError (404)
 * - Si el usuario no es owner ni miembro => ForbiddenError (403)
 * - Si el rol del usuario < minRole => ForbiddenError (403)
 * owner se considera rango máximo aunque no tenga fila en workspaceMembers.
 */
export async function assertWorkspaceAccess(
  workspaceId: string,
  userId: string,
  minRole: WorkspaceRole = 'viewer'
): Promise<{ role: WorkspaceRole; workspace: typeof workspaces.$inferSelect }> {
  if (!workspaceId || !userId) {
    throw new ForbiddenError('Acceso denegado')
  }

  const workspace = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get()

  if (!workspace) {
    throw new NotFoundError('Workspace no encontrado')
  }

  // Owner check: propietario tiene rango 'owner' siempre
  if (workspace.ownerId === userId) {
    const ownerRank = getRank('owner')
    const requiredRank = getRank(minRole)
    if (ownerRank < requiredRank) {
      throw new ForbiddenError('Permisos insuficientes')
    }
    return { role: 'owner', workspace }
  }

  const membership = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .get()

  if (!membership) {
    throw new ForbiddenError('No perteneces a este workspace')
  }

  const userRank = getRank(membership.role)
  const requiredRank = getRank(minRole)

  if (userRank < requiredRank) {
    throw new ForbiddenError(`Se requiere rol mínimo: ${minRole}`)
  }

  return { role: membership.role as WorkspaceRole, workspace }
}

/**
 * Alias: escritura requiere al menos 'member' (viewer solo lectura)
 */
export async function assertCanWrite(workspaceId: string, userId: string) {
  return assertWorkspaceAccess(workspaceId, userId, 'member')
}

/**
 * Alias: admin requiere al menos 'admin' (owner pasa, member/viewer no)
 */
export async function assertCanAdmin(workspaceId: string, userId: string) {
  return assertWorkspaceAccess(workspaceId, userId, 'admin')
}
