'use client'

import { useCallback, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { useCanvasStore, selectNodes, selectEdges } from '@/store/canvas-store'
import { useBoardStore } from '@/store/board-store'
import { useWorkspaceMembers } from '@/hooks/useWorkspaceMembers'
import type { Node, NodeStatus, NodeType, Edge, BoardColumn as BoardColumnType } from '@/lib/db/schema'
import { NODE_META } from '@/lib/canvas/node-meta'
import { mappedStatus, groupTasksByColumn } from '@/lib/canvas/board-columns'
import { orderForMoveToIndex } from '@/lib/canvas/board-move'
import { deleteNodeFromWorkspace } from '@/lib/canvas/node-mutations'
import { BoardColumn } from './BoardColumn'
import { CreateNodePopup } from '../canvas/CreateNodePopup'

type BoardProps = {
  workspaceId: string
  onSwitchToCanvas: () => void
}

// Estado del quick-add por columna: ancla el CreateNodePopup (screenPos) y da
// el flowPos del nodo nuevo (cascada por columna, ver decisión F6.1).
type QuickAddState = {
  screenPos: { x: number; y: number }
  flowPos: { x: number; y: number }
  status: NodeStatus
  boardColumnId: string
}

// ============================================================
// Lógica pura extraída para testear sin DOM (F6.1a)
// ============================================================

/** Solo los nodos tipo 'task' tienen status (NODE_STATUSES) — son los únicos
 *  con una columna donde vivir en el Tablero (decisión F6.1 #5). LEGACY: el
 *  tablero dinámico agrupa por columna; este helper queda para los tests y la
 *  vista "Hoy" (status canónico). */
export function groupTasksByStatus(nodes: Node[]): Record<NodeStatus, Node[]> {
  const tasks = nodes.filter((n) => n.type === 'task')
  return {
    todo: tasks.filter((n) => (n.status ?? 'todo') === 'todo'),
    in_progress: tasks.filter((n) => n.status === 'in_progress'),
    done: tasks.filter((n) => n.status === 'done'),
  }
}

/** Conteo por tipo de los nodos sin columna en el Tablero (decisión F6.1 #8).
 *  Devuelve solo tipos con count > 0, en orden canónico note→idea→person→resource. */
export function otherNodeCounts(nodes: Node[]): { type: NodeType; count: number }[] {
  const others = nodes.filter((n) => n.type !== 'task')
  const counts: { type: NodeType; count: number }[] = []
  for (const type of ['note', 'idea', 'person', 'resource'] as NodeType[]) {
    const count = others.filter((n) => n.type === type).length
    if (count > 0) counts.push({ type, count })
  }
  return counts
}

/** Tareas que bloquean a `node`: nodos destino de edges depends_on salientes
 *  que NO están 'done' (chips "Bloqueada por", decisión F6.1 #9). */
export function blockersOf(edges: Edge[], nodes: Node[], node: Node): Node[] {
  const targetIds = edges
    .filter((e) => e.type === 'depends_on' && e.sourceId === node.id)
    .map((e) => e.targetId)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  return targetIds
    .map((id) => byId.get(id))
    .filter((n): n is Node => !!n && n.status !== 'done')
}

/** Resuelve destino del drop: columna (prefijo `col:`) o tarjeta (nodeId). */
export function resolveDropTarget(
  overId: string,
  tasksByColumn: Record<string, Node[]>
): { columnId: string | null; indexInColumn: number } {
  if (overId.startsWith('col:')) {
    const columnId = overId.slice(4)
    const list = tasksByColumn[columnId]
    return { columnId, indexInColumn: list ? list.length : 0 }
  }
  // El over es una tarjeta: buscar en qué columna está y su índice.
  for (const [columnId, list] of Object.entries(tasksByColumn)) {
    const idx = list.findIndex((n) => n.id === overId)
    if (idx !== -1) return { columnId, indexInColumn: idx }
  }
  return { columnId: null, indexInColumn: 0 }
}

export function Board({ workspaceId, onSwitchToCanvas }: BoardProps) {
  const nodes = useCanvasStore(selectNodes)
  const edges = useCanvasStore(selectEdges)
  const columns = useBoardStore((s) => s.columns)
  const moveTask = useBoardStore((s) => s.moveTask)
  const createColumn = useBoardStore((s) => s.createColumn)
  const renameColumn = useBoardStore((s) => s.renameColumn)
  const deleteColumn = useBoardStore((s) => s.deleteColumn)
  const { byId: memberById } = useWorkspaceMembers(workspaceId)

  const [quickAdd, setQuickAdd] = useState<QuickAddState | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [addingColumn, setAddingColumn] = useState(false)
  const [newColumnTitle, setNewColumnTitle] = useState('')

  const { byColumn: tasksByColumn } = groupTasksByColumn(nodes, columns)
  const tasks = nodes.filter((n) => n.type === 'task')

  // Sensor: evita que el menú ⋯ / clicks se conviertan en drag accidental.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const handleDragStart = useCallback(({ active }: DragStartEvent) => {
    setDraggingId(String(active.id))
  }, [])

  // Drag inter/INTRA-columna: se salta la columna de status fija y delega en
  // POST /board/move vía board-store (optimista + rollback). El `toOrder` se
  // calcula con gaps sobre los hermanos de destino.
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggingId(null)
      const { active, over } = event
      if (!over) return
      const node = tasks.find((t) => t.id === active.id)
      if (!node) return
      const { columnId, indexInColumn } = resolveDropTarget(String(over.id), tasksByColumn)
      if (!columnId) return

      // IMPORTANTE: `@dnd-kit/sortable` reporta over.index relativo a la lista
      // incluyendo al propio nodo si se queda en la misma columna. Como nosotros
      // calculamos la posición a partir de la lista VISUAL del store (que ya
      // incluye al nodo), tomamos las órdenes de la columna destino SIN el
      // nodo en movimiento y pedimos el order del hueco `indexInColumn`.
      const siblings = (tasksByColumn[columnId] ?? [])
        .filter((n) => n.id !== node.id)
        .map((n) => n.boardOrder)
        .sort((a, b) => a - b)
      const toOrder = orderForMoveToIndex(siblings, indexInColumn)

      // No-op: misma columna y misma posición relativa.
      if (columnId === node.boardColumnId) {
        const visibleIdx = indexInColumn
        const currentIdx = (tasksByColumn[columnId] ?? []).findIndex((n) => n.id === node.id)
        if (visibleIdx === currentIdx) return
        // Ajuste por extracción: si se movió hacia la derecha dentro de la misma
        // columna, el hueco visible corre 1 menos tras sacar al nodo.
      }
      void moveTask(workspaceId, node.id, columnId, toOrder)
    },
    [tasks, tasksByColumn, moveTask, workspaceId]
  )

  // Menú "Mover a…" (fallback accesible): mueve al final de la columna destino.
  const handleMoveCard = useCallback(
    (nodeId: string, columnId: string) => {
      const target = (tasksByColumn[columnId] ?? []).map((n) => n.boardOrder).sort((a, b) => a - b)
      const toOrder = orderForMoveToIndex(target, target.length)
      void moveTask(workspaceId, nodeId, columnId, toOrder)
    },
    [tasksByColumn, moveTask, workspaceId]
  )

  // Eliminar tarea con confirmación (optimismo local vía node-mutations).
  const handleDeleteCard = useCallback(
    (node: Node) => {
      if (!window.confirm(`¿Eliminar la tarea “${node.title}”?`)) return
      deleteNodeFromWorkspace(workspaceId, node.id).catch((err) => {
        window.alert('No se pudo eliminar la tarea')
        console.error('[Board] delete failed', err)
      })
    },
    [workspaceId]
  )

  const memberName = useCallback(
    (userId: string) => memberById.get(userId)?.displayName ?? null,
    [memberById]
  )

  // Chip agregado por tipo (decisión F6.1 #8): notas/ideas/personas/recursos
  // no tienen columna de estado — se muestran como conteo y redirigen a Canvas.
  const otherCounts = otherNodeCounts(nodes)

  // Quick-add por columna: la columna pone el boardColumnId y el status mapeado.
  const handleAddTask = (columnId: string, screenPos: { x: number; y: number }) => {
    const countInCol = (tasksByColumn[columnId] ?? []).length
    setQuickAdd({
      screenPos,
      flowPos: { x: 20 + countInCol * 40, y: 20 + countInCol * 40 },
      status: mappedStatus(columnId, columns),
      boardColumnId: columnId,
    })
  }

  const handleRenameColumn = (column: BoardColumnType, title: string) => {
    renameColumn(workspaceId, column.id, title).catch((err) => {
      window.alert(err instanceof Error ? err.message : 'No se pudo renombrar la columna')
    })
  }

  const handleDeleteColumn = (column: BoardColumnType) => {
    const count = (tasksByColumn[column.id] ?? []).length
    if (count > 0) {
      if (!window.confirm(`La columna “${column.title}” tiene ${count} tarea(s). Se moverán a la primera columna restante. ¿Eliminar?`)) return
    } else if (!window.confirm(`¿Eliminar la columna “${column.title}”?`)) {
      return
    }
    deleteColumn(workspaceId, column.id).catch((err) => {
      window.alert(err instanceof Error ? err.message : 'No se pudo eliminar la columna')
    })
  }

  const submitNewColumn = () => {
    const title = newColumnTitle.trim()
    if (!title) {
      setAddingColumn(false)
      return
    }
    createColumn(workspaceId, title)
      .then(() => {
        setAddingColumn(false)
        setNewColumnTitle('')
      })
      .catch((err) => window.alert(err instanceof Error ? err.message : 'No se pudo crear la columna'))
  }

  if (columns.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Cargando tablero…</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex flex-1 gap-4 overflow-x-auto p-4">
          {columns.map((column) => (
            <BoardColumn
              key={column.id}
              column={column}
              allColumns={columns}
              nodes={tasksByColumn[column.id] ?? []}
              draggingId={draggingId}
              blockedBy={(node) => blockersOf(edges, nodes, node)}
              memberName={memberName}
              onAddTask={(col, pos) => handleAddTask(col.id, pos)}
              onMoveCard={handleMoveCard}
              onDeleteCard={handleDeleteCard}
              onRenameColumn={handleRenameColumn}
              onDeleteColumn={handleDeleteColumn}
            />
          ))}

          {/* Añadir columna */}
          <div className="flex w-40 shrink-0 items-start pt-1">
            {addingColumn ? (
              <div className="w-72 rounded-xl border border-border bg-muted/40 p-2">
                <input
                  autoFocus
                  value={newColumnTitle}
                  onChange={(e) => setNewColumnTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitNewColumn()
                    if (e.key === 'Escape') {
                      setAddingColumn(false)
                      setNewColumnTitle('')
                    }
                  }}
                  placeholder="Nombre de la columna"
                  className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={submitNewColumn}
                    className="rounded-lg bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
                  >
                    Añadir
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddingColumn(false)
                      setNewColumnTitle('')
                    }}
                    className="rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddingColumn(true)}
                className="flex w-full items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-sm text-muted-foreground hover:border-primary/50 hover:text-foreground"
              >
                + Añadir columna
              </button>
            )}
          </div>
        </div>
      </DndContext>

      {otherCounts.length > 0 && (
        <div className="flex items-center justify-between gap-2 border-t border-border bg-background px-4 py-2">
          <span className="text-xs text-muted-foreground">
            {otherCounts
              .map(({ type, count }) => `+${count} ${NODE_META[type].label.toLowerCase()}${count === 1 ? '' : 's'}`)
              .join(', ')}{' '}
            no tienen columna de estado
          </span>
          <button
            type="button"
            onClick={onSwitchToCanvas}
            className="rounded-lg px-2 py-1 text-xs font-medium text-primary hover:bg-muted active:bg-muted/80"
          >
            Ver en Canvas
          </button>
        </div>
      )}

      <CreateNodePopup
        key={quickAdd?.boardColumnId ?? 'none'}
        screenPos={quickAdd?.screenPos ?? null}
        flowPos={quickAdd?.flowPos ?? { x: 0, y: 0 }}
        workspaceId={workspaceId}
        initialType="task"
        initialStatus={quickAdd?.status ?? 'todo'}
        boardColumnId={quickAdd?.boardColumnId ?? null}
        onClose={() => setQuickAdd(null)}
      />
    </div>
  )
}