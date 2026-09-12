import { db } from '@/lib/db'
import {
  boardColumns,
  nodes,
  users,
  workspaceMembers,
  workspaces,
  type BoardColumn,
} from '@/lib/db/schema'
import { eq, and, isNull, asc, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import {
  createBoardColumnSchema,
  updateBoardColumnSchema,
  moveBoardTaskSchema,
} from '@/lib/validators/board-column'
import { publish } from '@/lib/sse/pubsub'
import { assertWorkspaceAccess, assertCanWrite } from '@/lib/auth/workspace-access'
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  UnprocessableError,
} from '@/lib/errors'
import { mapUniqueToConflict } from '@/lib/api-helpers'
import { mappedStatus, sortColumns } from '@/lib/canvas/board-columns'

function handleZodError(error: unknown): never {
  if (error instanceof Error && 'issues' in error) {
    const zodError = error as { issues: unknown; message: string }
    throw new ValidationError(zodError.message, zodError.issues)
  }
  throw error as never
}

async function assertAssigneeInWorkspace(workspaceId: string, assigneeId: string): Promise<void> {
  const user = await db.select({ id: users.id }).from(users).where(eq(users.id, assigneeId)).get()
  if (!user) {
    throw new UnprocessableError('El responsable no existe')
  }
  const ws = await db.select({ ownerId: workspaces.ownerId }).from(workspaces).where(eq(workspaces.id, workspaceId)).get()
  if (ws?.ownerId === assigneeId) return
  const membership = await db
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, assigneeId)))
    .get()
  if (!membership) {
    throw new UnprocessableError('El responsable no pertenece a este workspace')
  }
}

export async function assertBoardColumnInWorkspace(
  workspaceId: string,
  columnId: string
): Promise<BoardColumn> {
  const byId = await db.select().from(boardColumns).where(eq(boardColumns.id, columnId)).get()
  if (!byId) {
    throw new NotFoundError('Columna no encontrada')
  }
  if (byId.workspaceId !== workspaceId) {
    throw new UnprocessableError('La columna no pertenece a este workspace')
  }
  return byId
}

export async function ensureDefaultBoardColumns(workspaceId: string): Promise<BoardColumn[]> {
  const existing = await db
    .select()
    .from(boardColumns)
    .where(eq(boardColumns.workspaceId, workspaceId))
    .all()
  if (existing.length > 0) return sortColumns(existing)
  // Crea las 3 por defecto si el workspace aún no tiene (p. ej. creado antes de F0
  // y sin pasar por backfill). Idempotente por el guard previo.
  const now = new Date()
  const titles = ['Por hacer', 'En progreso', 'Hecho']
  const rows = titles.map((title, i) => ({
    id: uuidv4(),
    workspaceId,
    title,
    position: i * 1000,
    createdAt: now,
    updatedAt: now,
  }))
  try {
    await db.insert(boardColumns).values(rows)
  } catch (e) {
    mapUniqueToConflict(e)
  }
  const created = await db
    .select()
    .from(boardColumns)
    .where(eq(boardColumns.workspaceId, workspaceId))
    .all()
  return sortColumns(created)
}

// ============================================================
// CRUD columnas
// ============================================================

export async function listBoardColumns(workspaceId: string, userId: string) {
  await assertWorkspaceAccess(workspaceId, userId, 'viewer')
  const cols = await db
    .select()
    .from(boardColumns)
    .where(eq(boardColumns.workspaceId, workspaceId))
    .orderBy(asc(boardColumns.position))
    .all()
  if (cols.length === 0) {
    // Auto-provisión perezosa para workspaces pre-F0 sin backfill.
    await assertWorkspaceAccess(workspaceId, userId, 'viewer')
    return ensureDefaultBoardColumns(workspaceId)
  }
  return sortColumns(cols)
}

export async function createBoardColumn(workspaceId: string, userId: string, input: unknown) {
  await assertCanWrite(workspaceId, userId)
  let parsed: ReturnType<typeof createBoardColumnSchema.parse>
  try {
    parsed = createBoardColumnSchema.parse(input)
  } catch (e) {
    handleZodError(e)
  }

  // Unicidad NOCASE manual (SQLite UNIQUE es case-sensitive por defecto).
  const dup = await db
    .select({ id: boardColumns.id })
    .from(boardColumns)
    .where(
      and(
        eq(boardColumns.workspaceId, workspaceId),
        sql`lower(${boardColumns.title}) = lower(${parsed!.title})`
      )
    )
    .get()
  if (dup) {
    throw new ConflictError('Ya existe una columna con ese título')
  }

  let position = parsed!.position
  if (position === undefined) {
    const [row] = await db
      .select({ m: sql<number | null>`max(${boardColumns.position})` })
      .from(boardColumns)
      .where(eq(boardColumns.workspaceId, workspaceId))
      .all()
    const max = row?.m ?? null
    position = max == null ? 0 : max + 1000
  }

  const now = new Date()
  const id = uuidv4()
  try {
    const [inserted] = await db
      .insert(boardColumns)
      .values({
        id,
        workspaceId,
        title: parsed!.title,
        position,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    const finalCol = inserted ?? { id, workspaceId, title: parsed!.title, position, createdAt: now, updatedAt: now }
    publish(workspaceId, 'column:created', finalCol)
    return finalCol
  } catch (e) {
    mapUniqueToConflict(e, 'Ya existe una columna con ese título')
  }
}

export async function updateBoardColumn(
  workspaceId: string,
  columnId: string,
  userId: string,
  input: unknown
) {
  await assertCanWrite(workspaceId, userId)
  let parsed: ReturnType<typeof updateBoardColumnSchema.parse>
  try {
    parsed = updateBoardColumnSchema.parse(input)
  } catch (e) {
    handleZodError(e)
  }

  const existing = await assertBoardColumnInWorkspace(workspaceId, columnId)

  if (parsed!.title !== undefined) {
    const dup = await db
      .select({ id: boardColumns.id })
      .from(boardColumns)
      .where(
        and(
          eq(boardColumns.workspaceId, workspaceId),
          sql`lower(${boardColumns.title}) = lower(${parsed!.title})`
        )
      )
      .all()
    if (dup.some((d) => d.id !== columnId)) {
      throw new ConflictError('Ya existe una columna con ese título')
    }
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() }
  if (parsed!.title !== undefined) updateData.title = parsed!.title
  if (parsed!.position !== undefined) updateData.position = parsed!.position

  try {
    const [updated] = await db
      .update(boardColumns)
      .set(updateData as never)
      .where(and(eq(boardColumns.id, columnId), eq(boardColumns.workspaceId, workspaceId)))
      .returning()
    const finalCol = updated ?? { ...existing, ...updateData }
    publish(workspaceId, 'column:updated', finalCol)
    return finalCol
  } catch (e) {
    mapUniqueToConflict(e, 'Ya existe una columna con ese título')
  }
}

export async function deleteBoardColumn(
  workspaceId: string,
  columnId: string,
  userId: string,
  input?: unknown
) {
  await assertCanWrite(workspaceId, userId)
  const existing = await assertBoardColumnInWorkspace(workspaceId, columnId)

  let rehomeTo: string | null | undefined
  if (input !== undefined) {
    const { deleteBoardColumnSchema } = await import('@/lib/validators/board-column')
    try {
      const parsed = deleteBoardColumnSchema.parse(input ?? {})
      rehomeTo = parsed.rehomeTo
    } catch (e) {
      handleZodError(e)
    }
  }

  const all = sortColumns(
    await db.select().from(boardColumns).where(eq(boardColumns.workspaceId, workspaceId)).all()
  )
  if (all.length <= 1) {
    throw new ConflictError('No se puede eliminar la última columna del tablero')
  }

  let destId: string
  if (rehomeTo) {
    const dest = await assertBoardColumnInWorkspace(workspaceId, rehomeTo)
    if (dest.id === columnId) {
      throw new ValidationError('La columna destino debe ser distinta')
    }
    destId = dest.id
  } else {
    const fallback = all.find((c) => c.id !== columnId)
    if (!fallback) throw new ConflictError('No se puede eliminar la última columna del tablero')
    destId = fallback.id
  }

  // Rehoming + delete atómicos (better-sqlite3 tx síncrona, sin awaits dentro).
  const movedNodeIds: string[] = []
  db.transaction((tx) => {
    const toMove = tx
      .select({ id: nodes.id })
      .from(nodes)
      .where(
        and(
          eq(nodes.workspaceId, workspaceId),
          eq(nodes.boardColumnId, columnId),
          isNull(nodes.deletedAt)
        )
      )
      .all()
    const maxRow = tx
      .select({ m: sql<number | null>`max(${nodes.boardOrder})` })
      .from(nodes)
      .where(and(eq(nodes.workspaceId, workspaceId), eq(nodes.boardColumnId, destId)))
      .get() as { m: number | null } | undefined
    let next = Number(maxRow?.m) || 0
    const now = new Date()
    for (const row of toMove) {
      next += 1000
      tx.update(nodes)
        .set({ boardColumnId: destId, boardOrder: next, updatedAt: now } as never)
        .where(and(eq(nodes.id, row.id), eq(nodes.workspaceId, workspaceId)))
        .run()
      movedNodeIds.push(row.id)
    }
    tx.delete(boardColumns)
      .where(and(eq(boardColumns.id, columnId), eq(boardColumns.workspaceId, workspaceId)))
      .run()
  })

  // Eventos post-tx (fuera de la transacción).
  for (const nid of movedNodeIds) {
    const fresh = await db.select().from(nodes).where(eq(nodes.id, nid)).get()
    if (fresh) publish(workspaceId, 'node:updated', fresh)
  }
  publish(workspaceId, 'column:deleted', { id: columnId, workspaceId })

  return { ...existing, rehomedTo: destId, rehomedCount: movedNodeIds.length }
}

// ============================================================
// POST /board/move — mover task entre/ dentro de columnas (atómico)
// ============================================================

export async function moveBoardTask(workspaceId: string, userId: string, input: unknown) {
  await assertCanWrite(workspaceId, userId)
  let parsed: ReturnType<typeof moveBoardTaskSchema.parse>
  try {
    parsed = moveBoardTaskSchema.parse(input)
  } catch (e) {
    handleZodError(e)
  }

  const node = await db
    .select()
    .from(nodes)
    .where(and(eq(nodes.id, parsed!.nodeId), eq(nodes.workspaceId, workspaceId), isNull(nodes.deletedAt)))
    .get()
  if (!node) {
    throw new NotFoundError('Tarea no encontrada')
  }
  if (node.type !== 'task') {
    throw new UnprocessableError('Solo las tareas pueden moverse en el tablero')
  }
  const dest = await assertBoardColumnInWorkspace(workspaceId, parsed!.toColumnId)

  const columnsOrdered = sortColumns(
    await db.select().from(boardColumns).where(eq(boardColumns.workspaceId, workspaceId)).all()
  )
  const nextStatus = mappedStatus(dest.id, columnsOrdered)

  let toOrder = parsed!.toOrder
  if (toOrder === undefined) {
    const maxRow = await db
      .select({ m: sql<number | null>`max(${nodes.boardOrder})` })
      .from(nodes)
      .where(
        and(
          eq(nodes.workspaceId, workspaceId),
          eq(nodes.boardColumnId, dest.id),
          isNull(nodes.deletedAt)
        )
      )
      .get()
    const max = Number((maxRow as { m: number | null } | undefined)?.m) || 0
    // Si la tarea ya está en destino y es la única, conserva su orden.
    toOrder = max + 1000
    if (node.boardColumnId === dest.id && Number(node.boardOrder) >= max) {
      toOrder = Number(node.boardOrder)
    }
  }

  const now = new Date()
  db.transaction((tx) => {
    tx.update(nodes)
      .set(
        {
          boardColumnId: dest.id,
          boardOrder: toOrder,
          status: nextStatus,
          updatedAt: now,
        } as never
      )
      .where(and(eq(nodes.id, node.id), eq(nodes.workspaceId, workspaceId)))
      .run()
  })

  const updated = await db.select().from(nodes).where(eq(nodes.id, node.id)).get()
  const finalNode = updated ?? { ...node, boardColumnId: dest.id, boardOrder: toOrder, status: nextStatus }
  publish(workspaceId, 'node:updated', finalNode)
  return finalNode
}

export { assertAssigneeInWorkspace }
