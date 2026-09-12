'use client'

import { useDroppable } from '@dnd-kit/core'
import { Plus } from 'lucide-react'
import type { Node, NodeStatus } from '@/lib/db/schema'
import { cn } from '@/lib/utils'
import { BoardCard } from './BoardCard'

const STATUS_LABELS: Record<NodeStatus, string> = {
  todo: 'Por hacer',
  in_progress: 'En progreso',
  done: 'Hecho',
}

const COLUMN_DOT: Record<NodeStatus, string> = {
  todo: 'bg-muted-foreground/50',
  in_progress: 'bg-accent',
  done: 'bg-emerald-500',
}

type BoardColumnProps = {
  status: NodeStatus
  nodes: Node[]
  /** Id del nodo arrastrando (para opacar la tarjeta de origen). */
  draggingId: string | null
  /** Resuelve las tareas que bloquean a cada task (chip "Bloqueada por"). */
  blockedBy: (node: Node) => Node[]
  /** Abre el quick-add en esta columna (decisión F6.1 #7). */
  onAddTask: (status: NodeStatus, screenPos: { x: number; y: number }) => void
}

// Columna droppable del Tablero. El id del droppable ES el status: así onDragEnd
// del Board determina la columna destino con solo leer over.id (decisión F6.1 #6).
export function BoardColumn({ status, nodes, draggingId, blockedBy, onAddTask }: BoardColumnProps) {
  const { isOver, setNodeRef } = useDroppable({ id: status })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-w-72 flex-1 flex-col rounded-xl border border-border bg-muted/40',
        isOver && 'ring-2 ring-ring ring-offset-1'
      )}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', COLUMN_DOT[status])} aria-hidden />
          <span className="text-sm font-semibold">{STATUS_LABELS[status]}</span>
          <span className="rounded-full bg-background px-1.5 py-0.5 text-xs text-muted-foreground">
            {nodes.length}
          </span>
        </div>
        <button
          type="button"
          onClick={(e) => onAddTask(status, { x: e.clientX, y: e.clientY })}
          aria-label={`Crear tarea en ${STATUS_LABELS[status]}`}
          title={`Crear tarea en ${STATUS_LABELS[status]}`}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted/80"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
        {nodes.map((node) => (
          <BoardCard
            key={node.id}
            node={node}
            blockedBy={blockedBy(node)}
            dragging={draggingId === node.id}
          />
        ))}
        {nodes.length === 0 && (
          <p className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
            Sin tareas
          </p>
        )}
      </div>
    </div>
  )
}