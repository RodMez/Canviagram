'use client'

import { useEffect, useRef, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CalendarClock, Lock, MoreHorizontal, Trash2, MoveRight } from 'lucide-react'
import type { BoardColumn, Node, NodeStatus } from '@/lib/db/schema'
import { useCanvasStore } from '@/store/canvas-store'
import { cn } from '@/lib/utils'
import { PriorityBadge } from './PriorityBadge'
import { EffortChip } from './EffortChip'
import { AssigneeAvatar } from './AssigneeAvatar'

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
  /** Todas las columnas del tablero (para el submenú "Mover a"). */
  columns: BoardColumn[]
  /** Display name del responsable (lookup por assigneeId), si existe. */
  assigneeName?: string | null
  /** Mover la tarjeta al FINAL de otra columna (fallback accesible al DnD). */
  onMoveTo: (columnId: string) => void
  /** Eliminar la tarea (confirmada en Board). */
  onDelete: () => void
}

// Tarjeta del Tablero: enriquecida (F2) con responsable, prioridad, esfuerzo,
// menú ⋯ (Mover a… / Eliminar) y drag interno por posición (sortable).
// El clic sin arrastrar selecciona la tarea igual que un nodo en el Canvas.
export function BoardCard({
  node,
  blockedBy,
  dragging,
  columns,
  assigneeName,
  onMoveTo,
  onDelete,
}: BoardCardProps) {
  const selectNode = useCanvasStore((s) => s.selectNode)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: node.id,
  })
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const isDone = node.status === 'done'
  const due = node.dueDate ? new Date(node.dueDate) : null
  const overdue = !isDone && !!due && due.getTime() < Date.now()

  // Cerrar menú: click fuera / Escape.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as HTMLElement)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => selectNode(node.id)}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        'cursor-grab rounded-lg border border-border bg-card p-3 shadow-sm transition-shadow active:cursor-grabbing',
        isDragging && 'z-30 shadow-lg ring-2 ring-ring ring-offset-1',
        dragging && 'opacity-50',
        due && overdue && 'border-destructive/40'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={cn('min-w-0 truncate text-sm font-semibold', isDone && 'text-muted-foreground line-through')}>
          {node.title}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px] font-medium',
              STATUS_STYLES[node.status ?? 'todo']
            )}
          >
            {(node.status ?? 'todo').replace('_', ' ')}
          </span>
          <button
            type="button"
            aria-label="Acciones de la tarea"
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen((o) => !o)
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>

      {node.content ? (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{node.content}</p>
      ) : null}

      {/* Fila de metadatos: responsable + prioridad + esfuerzo + fecha */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {node.assigneeId ? (
          <span className="flex items-center gap-1" title={assigneeName ?? 'Responsable'}>
            <AssigneeAvatar displayName={assigneeName} />
            {assigneeName && <span className="max-w-20 truncate text-[10px] text-muted-foreground">{assigneeName}</span>}
          </span>
        ) : (
          <AssigneeAvatar displayName={null} />
        )}
        <PriorityBadge priority={node.priority} />
        <EffortChip effort={node.effort} />
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

      {blockedBy.length > 0 && (
        <div className="mt-2 flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-1 text-[10px] font-medium text-destructive">
          <Lock className="h-3 w-3 shrink-0" />
          <span className="min-w-0 truncate">
            Bloqueada por: {blockedBy.map((b) => b.title).join(', ')}
          </span>
        </div>
      )}

      {/* Menú ⋯: Mover a… / Eliminar */}
      <div className="relative" ref={menuRef}>
        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-1 z-50 w-44 rounded-lg border bg-popover p-1 shadow-lg"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase text-muted-foreground">
              Mover a
            </p>
            {columns
              .filter((c) => c.id !== node.boardColumnId)
              .map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    onMoveTo(c.id)
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                >
                  <MoveRight className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="truncate">{c.title}</span>
                </button>
              ))}
            <div className="my-1 border-t border-border" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false)
                onDelete()
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Eliminar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}