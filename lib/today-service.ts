import { db } from '@/lib/db'
import { nodes, workspaces, workspaceMembers } from '@/lib/db/schema'
import { and, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm'
import type { NodeStatus, NodeType } from '@/lib/db/schema'

// ============================================================
// Vista Hoy / Enfoque (F5.4): agregado cross-workspace.
//
// Junta lo accionable de TODOS los workspaces del usuario
// (owner o member — mismo criterio que GET /api/workspaces):
// nodos con dueDate O (task con status todo/in_progress).
// Notas/ideas sin fecha no aparecen (no accionables por sí solas);
// los done nunca aparecen.
//
// Buckets (en este orden): overdue → today → upcoming →
// in_progress (sin fecha) → backlog (todo sin fecha, colapsado en UI).
// Invariante: todo nodo del scope cae en algún bucket (las fechas
// futuras más allá de 7 días van a upcoming, no se dropean).
// ============================================================

export type TodayBucket = 'overdue' | 'today' | 'upcoming' | 'in_progress' | 'backlog'

export type TodayItem = {
  nodeId: string
  workspaceId: string
  workspaceName: string
  workspaceSlug: string
  type: NodeType
  title: string
  status: NodeStatus | null
  dueDate: Date | null
  bucket: TodayBucket
}

export function bucketFor(dueDate: Date | null, status: NodeStatus | null, now = new Date()): TodayBucket {
  if (dueDate) {
    const startOfToday = new Date(now)
    startOfToday.setHours(0, 0, 0, 0)
    const startOfTomorrow = new Date(startOfToday)
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1)
    if (dueDate.getTime() < now.getTime()) return 'overdue'
    if (dueDate.getTime() < startOfTomorrow.getTime()) return 'today'
    return 'upcoming'
  }
  if (status === 'in_progress') return 'in_progress'
  return 'backlog'
}

const BUCKET_ORDER: Record<TodayBucket, number> = {
  overdue: 0,
  today: 1,
  upcoming: 2,
  in_progress: 3,
  backlog: 4,
}

export async function getTodayItems(userId: string, now = new Date()): Promise<TodayItem[]> {
  if (!userId) return []

  // Mismo criterio que GET /api/workspaces: owned + member (sin duplicados).
  const owned = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.ownerId, userId))
    .all()
  const memberships = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        ne(workspaces.ownerId, userId)
      )
    )
    .all()
  const workspaceIds = [...owned.map((w) => w.id), ...memberships.map((m) => m.workspaceId)]
  if (workspaceIds.length === 0) return []

  const wsRows = await db
    .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug })
    .from(workspaces)
    .where(inArray(workspaces.id, workspaceIds))
    .all()
  const wsById = new Map(wsRows.map((w) => [w.id, w]))

  const rows = await db
    .select()
    .from(nodes)
    .where(
      and(
        inArray(nodes.workspaceId, workspaceIds),
        isNull(nodes.deletedAt),
        // Los done nunca aparecen, tengan fecha o no.
        or(isNull(nodes.status), ne(nodes.status, 'done')),
        or(
          isNotNull(nodes.dueDate),
          and(
            eq(nodes.type, 'task'),
            inArray(nodes.status, ['todo', 'in_progress'])
          )
        )
      )
    )
    .all()

  const items: TodayItem[] = []
  for (const n of rows) {
    const ws = wsById.get(n.workspaceId)
    if (!ws) continue
    items.push({
      nodeId: n.id,
      workspaceId: n.workspaceId,
      workspaceName: ws.name,
      workspaceSlug: ws.slug,
      type: n.type,
      title: n.title,
      status: n.status,
      dueDate: n.dueDate,
      bucket: bucketFor(n.dueDate, n.status, now),
    })
  }

  // overdue/today/upcoming por dueDate asc; in_progress y backlog al final.
  items.sort((a, b) => {
    const order = BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket]
    if (order !== 0) return order
    if (a.dueDate && b.dueDate) return a.dueDate.getTime() - b.dueDate.getTime()
    return a.title.localeCompare(b.title, 'es')
  })

  return items
}
