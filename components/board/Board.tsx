'use client'

import { useCallback, useState } from 'react'
import { DndContext, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { useCanvasStore, selectNodes, selectEdges } from '@/store/canvas-store'
import type { Node, NodeStatus, NodeType, Edge } from '@/lib/db/schema'
import { NODE_STATUSES } from '@/lib/db/schema'
import { NODE_META } from '@/lib/canvas/node-meta'
import { patchTaskStatus } from '@/lib/canvas/task-status'
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
}

// ============================================================
// Lógica pura extraída para testear sin DOM (F6.1a)
// ============================================================

/** Solo los nodos tipo 'task' tienen status (NODE_STATUSES) — son los únicos
 *  con una columna donde vivir en el Tablero (decisión F6.1 #5). */
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
 *  que NO están 'done' (chips "Bloqueada por", decisión F6.1 #9). Direccionalidad
 *  verificada en lib/demo/fixtures.ts: demo-task-1 --depends_on "requiere"→ demo-task-2
 *  ⇒ el source es el que depende (queda bloqueado si el target no está done). */
export function blockersOf(edges: Edge[], nodes: Node[], node: Node): Node[] {
  const targetIds = edges
    .filter((e) => e.type === 'depends_on' && e.sourceId === node.id)
    .map((e) => e.targetId)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  return targetIds
    .map((id) => byId.get(id))
    .filter((n): n is Node => !!n && n.status !== 'done')
}

export function Board({ workspaceId, onSwitchToCanvas }: BoardProps) {
  const nodes = useCanvasStore(selectNodes)
  const edges = useCanvasStore(selectEdges)
  const [quickAdd, setQuickAdd] = useState<QuickAddState | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const { todo, in_progress, done } = groupTasksByStatus(nodes)
  const tasksByStatus = { todo, in_progress, done }
  const tasks = nodes.filter((n) => n.type === 'task')

  const handleDragStart = useCallback(({ active }: DragStartEvent) => {
    setDraggingId(String(active.id))
  }, [])

  // Drag entre columnas → cambia status (decisión F6.1 #6). El id del droppable
  // de cada columna ES el status; el id del draggable es el node id.
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggingId(null)
      const { active, over } = event
      if (!over) return
      const node = tasks.find((t) => t.id === active.id)
      if (!node) return
      const target = over.id as NodeStatus
      if (!NODE_STATUSES.includes(target)) return
      if ((node.status ?? 'todo') === target) return
      patchTaskStatus(workspaceId, node, target)
    },
    [tasks, workspaceId]
  )

  // Chip agregado por tipo (decisión F6.1 #8): notas/ideas/personas/recursos
  // no tienen columna de estado — se muestran como conteo y redirigen a Canvas.
  const otherCounts = otherNodeCounts(nodes)

  // Quick-add por columna: reutiliza CreateNodePopup con type/status iniciales
  // (decisión F6.1 #7). El flowPos del nodo nuevo usa una cascada por columna
  // para no superponerlos al cambiar a Canvas.
  const handleAddTask = (status: NodeStatus, screenPos: { x: number; y: number }) => {
    const k = tasksByStatus[status].length
    setQuickAdd({ screenPos, flowPos: { x: 20 + k * 40, y: 20 + k * 40 }, status })
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-1 gap-4 overflow-x-auto p-4">
        {NODE_STATUSES.map((status) => (
          <BoardColumn
            key={status}
            status={status}
            nodes={tasksByStatus[status]}
            draggingId={draggingId}
            blockedBy={(node) => blockersOf(edges, nodes, node)}
            onAddTask={handleAddTask}
          />
        ))}
      </div>

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
        screenPos={quickAdd?.screenPos ?? null}
        flowPos={quickAdd?.flowPos ?? { x: 0, y: 0 }}
        workspaceId={workspaceId}
        initialType="task"
        initialStatus={quickAdd?.status ?? 'todo'}
        onClose={() => setQuickAdd(null)}
      />
    </div>
  )
}