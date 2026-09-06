// server-only
import { db } from '@/lib/db'
import { workspaces, workspaceMembers } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { NotFoundError, ForbiddenError } from '@/lib/errors'

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
