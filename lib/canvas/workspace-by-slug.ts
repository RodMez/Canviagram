// server-only
import { db } from '@/lib/db'
import { workspaces, workspaceMembers } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { NotFoundError, ForbiddenError } from '@/lib/errors'

/**
 * Lista los workspaces a los que un usuario tiene acceso: los que es dueño
 * (owner) más aquellos donde tiene fila en workspaceMembers.
 * Usado por el bot en /lista para cambiar el workspace activo del chat.
 */
export async function listWorkspacesForUser(userId: string) {
  if (!userId) return []
  const owned = await db.select().from(workspaces).where(eq(workspaces.ownerId, userId))
  const memberships = await db
    .select({ workspace: workspaces })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
  const memberWorkspaces = memberships.map((m) => m.workspace)
  return [...owned, ...memberWorkspaces]
}

/**
 * Resuelve un workspace por su slug y valida la membresía del usuario.
 * Devuelve { workspace, role } sin duplicar canvas-service.
 * - owner del workspace → role 'owner'
 * - miembro en workspaceMembers → su role
 * - sin acceso → ForbiddenError
 */
export async function resolveWorkspaceBySlug(slug: string, userId: string) {
  const ws = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, slug))
    .get()

  if (!ws) throw new NotFoundError('Workspace no encontrado')

  if (ws.ownerId === userId) {
    return { workspace: ws, role: 'owner' as const }
  }

  const member = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, ws.id),
        eq(workspaceMembers.userId, userId)
      )
    )
    .get()

  if (!member) throw new ForbiddenError('No tienes acceso a este workspace')

  return { workspace: ws, role: member.role }
}
