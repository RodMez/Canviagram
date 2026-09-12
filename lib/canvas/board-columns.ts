import type { BoardColumn, Node, NodeStatus } from '@/lib/db/schema'

export const BOARD_ORDER_GAP = 1000

// Ordena columnas por position asc (estable por title como desempate).
export function sortColumns(columns: BoardColumn[]): BoardColumn[] {
  return [...columns].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position
    return a.title.localeCompare(b.title)
  })
}

// Mapea una columna a un NODE_STATUS existente sin inventar estados nuevos.
// Regla posicional: primera → todo, última → done, intermedias → in_progress.
// Con 1 columna → todo; con 2 → todo/done. No toca NODE_STATUSES.
export function mappedStatus(
  columnId: string,
  orderedColumns: BoardColumn[]
): NodeStatus {
  if (orderedColumns.length === 0) return 'todo'
  if (orderedColumns.length === 1) return 'todo'
  const idx = orderedColumns.findIndex((c) => c.id === columnId)
  if (idx === -1) return 'todo'
  if (idx === 0) return 'todo'
  if (idx === orderedColumns.length - 1) return 'done'
  return 'in_progress'
}

// Agrupa tasks por columna para el tablero. Las tasks sin boardColumnId
// caen a la primera columna (tras backfill no debería haber ninguna, pero
// la UI no debe perderlas). Los no-task se excluyen (no tienen columna).
export function groupTasksByColumn(
  nodes: Node[],
  orderedColumns: BoardColumn[]
): { byColumn: Record<string, Node[]>; unassigned: Node[] } {
  const byColumn: Record<string, Node[]> = {}
  for (const c of orderedColumns) byColumn[c.id] = []
  const unassigned: Node[] = []
  const firstId = orderedColumns[0]?.id ?? null

  for (const n of nodes) {
    if (n.type !== 'task') continue
    if (n.boardColumnId && byColumn[n.boardColumnId]) {
      byColumn[n.boardColumnId].push(n)
    } else if (firstId) {
      byColumn[firstId].push(n)
    } else {
      unassigned.push(n)
    }
  }
  for (const id of Object.keys(byColumn)) {
    byColumn[id].sort((a, b) => a.boardOrder - b.boardOrder)
  }
  return { byColumn, unassigned }
}

// Ordena tasks de una columna por boardOrder asc.
export function sortTasksByOrder(tasks: Node[]): Node[] {
  return [...tasks].sort((a, b) => a.boardOrder - b.boardOrder)
}

// Búsqueda NOCASE de título duplicado (misma regla que el servicio).
export function hasDuplicateTitle(
  columns: BoardColumn[],
  title: string,
  excludeId?: string
): boolean {
  const needle = title.trim().toLowerCase()
  return columns.some(
    (c) => c.id !== excludeId && c.title.trim().toLowerCase() === needle
  )
}

// Primera columna cuyo status mapeado coincide con `status` (regla del servicio
// para sincronizar canvas → board: cambiar status en el detalle/canvas mueve la
// tarea a la primera columna que representa ese status).
export function columnForStatus(
  orderedColumns: BoardColumn[],
  status: NodeStatus
): BoardColumn | undefined {
  return orderedColumns.find((c) => mappedStatus(c.id, orderedColumns) === status)
}
