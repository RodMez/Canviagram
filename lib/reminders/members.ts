import { db } from '@/lib/db'
import { workspaces, workspaceMembers } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

// ============================================================
// Miembros de un workspace (Fase 3 — remitentes de recordatorios)
//
// El sweeper de recordatorios no tiene contexto de usuario, así que
// no puede usar assertWorkspaceAccess (que exige userId). Este helper
// devuelve el conjunto de destinatarios de un workspace: el owner
// (workspaces.ownerId) + todos los userId de workspaceMembers.
// ============================================================

export async function getWorkspaceRecipients(workspaceId: string): Promise<string[]> {
  const ws = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get()
  if (!ws) return []

  const memberRows = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .all()

  const ids = new Set<string>([ws.ownerId])
  for (const m of memberRows) ids.add(m.userId)
  return [...ids]
}

export async function getWorkspaceSlug(workspaceId: string): Promise<string | null> {
  const ws = await db.select({ slug: workspaces.slug }).from(workspaces).where(eq(workspaces.id, workspaceId)).get()
  return ws?.slug ?? null
}