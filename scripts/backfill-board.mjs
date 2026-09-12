/**
 * Backfill idempotente del tablero enriquecido (F0).
 *
 * Por cada workspace, en UNA transacción síncrona (better-sqlite3):
 *  1. Si no tiene columnas en `board_columns`, crea las 3 por defecto
 *     ("Por hacer", "En progreso", "Hecho") con positions 0/1000/2000.
 *  2. Asigna `board_column_id` a las tasks vivas con NULL según `status`:
 *     todo/NULL → primera, in_progress → segunda, done → tercera.
 *     Los no-task se dejan con NULL (no tienen columna).
 *  3. Asigna `board_order` con gaps *1000 ordenado por createdAt, partiendo
 *     de MAX(board_order) existente por columna (idempotente: segunda
 *     ejecución no toca filas ya asignadas).
 *
 * Uso: node scripts/backfill-board.mjs
 * Env: DATABASE_URL (default canviagram.db, soporta prefijo file: y query params).
 */
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'

function resolveDbPath() {
  let rawUrl = process.env.DATABASE_URL ?? 'canviagram.db'
  let dbPath = rawUrl
  if (dbPath.startsWith('file:')) dbPath = dbPath.slice(5)
  const qIdx = dbPath.indexOf('?')
  if (qIdx !== -1) dbPath = dbPath.slice(0, qIdx)
  if (!dbPath) dbPath = 'canviagram.db'
  return { rawUrl, dbPath }
}

const { rawUrl, dbPath } = resolveDbPath()
console.log(`[backfill-board] DATABASE_URL=${rawUrl} resolved to ${dbPath}`)

const sqlite = new Database(dbPath, { timeout: 5000 })
sqlite.pragma('busy_timeout = 5000')
sqlite.pragma('foreign_keys = ON')

const DEFAULT_TITLES = ['Por hacer', 'En progreso', 'Hecho']

function hasTable(name) {
  const row = sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name)
  return !!row
}

function hasColumn(table, column) {
  const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all()
  return rows.some((r) => r.name === column)
}

if (!hasTable('board_columns') || !hasColumn('nodes', 'board_column_id')) {
  console.error(
    '[backfill-board] FAILED: faltan board_columns o nodes.board_column_id. Ejecuta las migraciones primero (npm run build o node scripts/migrate.mjs).'
  )
  process.exit(1)
}

const listWorkspaces = sqlite.prepare(`SELECT id FROM workspaces`).all()
console.log(`[backfill-board] workspaces: ${listWorkspaces.length}`)

const getColumns = sqlite.prepare(
  `SELECT id, title, position FROM board_columns WHERE workspace_id=? ORDER BY position ASC, title ASC`
)
const insertColumn = sqlite.prepare(
  `INSERT INTO board_columns (id, workspace_id, title, position, created_at, updated_at) VALUES (?, ?, ?, ?, unixepoch(), unixepoch())`
)
const maxOrderStmt = sqlite.prepare(
  `SELECT COALESCE(MAX(board_order), 0) AS m FROM nodes WHERE workspace_id=? AND board_column_id=? AND deleted_at IS NULL`
)
const unassignedByStatus = sqlite.prepare(
  `SELECT id, status FROM nodes WHERE workspace_id=? AND type='task' AND deleted_at IS NULL AND board_column_id IS NULL ORDER BY created_at ASC, id ASC`
)
const assignStmt = sqlite.prepare(
  `UPDATE nodes SET board_column_id=?, board_order=?, updated_at=unixepoch() WHERE id=? AND workspace_id=?`
)

let totalColumnsCreated = 0
let totalNodesAssigned = 0

for (const ws of listWorkspaces) {
  const workspaceId = ws.id
  const tx = sqlite.transaction(() => {
    let columns = getColumns.all(workspaceId)
    if (columns.length === 0) {
      const now = Date.now()
      DEFAULT_TITLES.forEach((title, i) => {
        insertColumn.run(randomUUID(), workspaceId, title, i * 1000)
      })
      totalColumnsCreated += DEFAULT_TITLES.length
      columns = getColumns.all(workspaceId)
      console.log(`[backfill-board] ${workspaceId}: creadas ${DEFAULT_TITLES.length} columnas (${now})`)
    }
    // Mapeo status → columna por posición: primera=todo, segunda=in_progress, tercera=done.
    // Si el workspace tiene ≠3 columnas (usuario ya personalizó), se mapea:
    // primera → todo, última → done, resto → segunda (o primera si solo hay 1-2).
    const firstId = columns[0]?.id ?? null
    const lastId = columns.length > 1 ? columns[columns.length - 1].id : firstId
    const midId = columns.length > 2 ? columns[1].id : (columns.length > 1 ? columns[1].id : firstId)
    if (!firstId) return { assigned: 0 }

    const pending = unassignedByStatus.all(workspaceId)
    if (pending.length === 0) return { assigned: 0 }

    // Agrupa pendientes por columna destino preservando orden createdAt.
    const byColumn = new Map()
    for (const n of pending) {
      const dest = n.status === 'done' ? lastId : n.status === 'in_progress' ? midId : firstId
      if (!byColumn.has(dest)) byColumn.set(dest, [])
      byColumn.get(dest).push(n)
    }
    let assigned = 0
    for (const [colId, list] of byColumn) {
      const { m } = maxOrderStmt.get(workspaceId, colId)
      let next = Number(m) || 0
      for (const n of list) {
        next += 1000
        assignStmt.run(colId, next, n.id, workspaceId)
        assigned += 1
      }
    }
    return { assigned }
  })

  try {
    const { assigned } = tx()
    totalNodesAssigned += assigned
    if (assigned > 0) console.log(`[backfill-board] ${workspaceId}: asignados ${assigned} nodos`)
  } catch (error) {
    console.error(`[backfill-board] FAILED workspace ${workspaceId}`, error)
    process.exit(1)
  }
}

console.log(
  `[backfill-board] OK columnsCreated=${totalColumnsCreated} nodesAssigned=${totalNodesAssigned}`
)
sqlite.close()
