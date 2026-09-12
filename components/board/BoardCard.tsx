'use client'

import { useDraggable } from '@dnd-kit/core'
import { CalendarClock, Lock } from 'lucide-react'
import type { Node, NodeStatus } from '@/lib/db/schema'
import { useCanvasStore } from '@/store/canvas-store'
import { cn } from '@/lib/utils'

const STATUS_STYLES: Record<NodeStatus, string> = {
  todo: 'bg-muted text-muted-foreground',
  in_progress: 'bg-accent/15 text-accent',
  done: 'bg-emerald-500/15 text-emerald-700',
}

type BoardCardProps = {
  node: Node
  /** Tareas que todavía no están 'done' y de las que `node` depende. */
  blockedBy: Node[]
  /** True mientras este nodo se está arrastrando (opacar el original). */
  dragging: boolean
}

// Tarjeta del Tablero (decisión F6.1 #10): el clic sin arrastrar selecciona la
// tarea igual que un nodo del Canvas — RightPanel cambia a NodeDetailPanel sin
// código nuevo. El drag entre columnas cambia status vía patchTaskStatus.
export function BoardCard({ node, blockedBy, dragging }: BoardCardProps) {
  const selectNode = useCanvasStore((s) => s.selectNode)
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: node.id })
  const isDone = node.status === 'done'
  const due = node.dueDate ? new Date(node.dueDate) : null
  const overdue = !isDone && !!due && due.getTime() < Date.now()

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => selectNode(node.id)}
      className={cn(
        'cursor-grab rounded-lg border border-border bg-card p-3 shadow-sm transition-opacity active:cursor-grabbing',
        isDragging && 'opacity-60',
        due && overdue && 'border-destructive/40',
        dragging && 'opacity-50'
      )}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cn('min-w-0 truncate text-sm font-semibold', isDone && 'text-muted-foreground line-through')}>
          {node.title}
        </span>
        <span
          className={cn(
            'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
            STATUS_STYLES[node.status ?? 'todo']
          )}
        >
          {(node.status ?? 'todo').replace('_', ' ')}
        </span>
      </div>

      {node.content ? (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{node.content}</p>
      ) : null}

      {(due || node.recurrenceRule) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {due && (
            <span
              className={cn(
                'flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
                overdue ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground'
              )}
            >
              <CalendarClock className="h-3 w-3" />
              {due.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
            </span>
          )}
          {node.recurrenceRule && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {node.recurrenceRule}
            </span>
          )}
        </div>
      )}

      {blockedBy.length > 0 && (
        <div className="mt-2 flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-1 text-[10px] font-medium text-destructive">
          <Lock className="h-3 w-3 shrink-0" />
          <span className="min-w-0 truncate">
            Bloqueada por: {blockedBy.map((b) => b.title).join(', ')}
          </span>
        </div>
      )}
    </div>
  )
}