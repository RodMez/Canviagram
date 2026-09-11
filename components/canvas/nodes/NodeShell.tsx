'use client'

import { Handle, Position } from '@xyflow/react'
import type { ReactNode } from 'react'
import { CalendarClock } from 'lucide-react'
import type { Node as DBNode } from '@/lib/db/schema'
import { NODE_META } from '@/lib/canvas/node-meta'
import { cn } from '@/lib/utils'

type NodeShellProps = {
  domain: DBNode
  children?: ReactNode
  /** Optional badge rendered next to the type label */
  badge?: ReactNode
}

// Indicador de fecha límite (Fase 3): chip con la fecha, en rojo si está vencida
// (salvo tasks completadas).
export function DueDateChip({ domain }: { domain: DBNode }) {
  if (!domain.dueDate) return null
  const due = new Date(domain.dueDate)
  const isDoneTask = domain.type === 'task' && domain.status === 'done'
  const overdue = !isDoneTask && due.getTime() < Date.now()

  return (
    <span
      className={cn(
        'flex w-fit items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
        overdue ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground'
      )}
    >
      <CalendarClock className="h-3 w-3" />
      {due.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
    </span>
  )
}

export function NodeShell({ domain, children, badge }: NodeShellProps) {
  const meta = NODE_META[domain.type]
  const Icon = meta.icon
  const isDone = domain.type === 'task' && domain.status === 'done'
  const isOverdue =
    !isDone && !!domain.dueDate && new Date(domain.dueDate).getTime() < Date.now()

  return (
    <div
      className={cn(
        'rounded-xl border-2 bg-card shadow-md min-w-[160px] max-w-[260px] text-sm transition-all',
        meta.accent,
        isDone && 'opacity-70',
        isOverdue && 'ring-2 ring-destructive ring-offset-1',
      )}
    >
      <Handle type="target" position={Position.Left} className="!w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!w-2 !h-2" />

      <div className="flex items-center gap-2 px-3 py-2">
        <Icon className="h-4 w-4 shrink-0 text-primary" />
        <span className={cn('font-semibold truncate', isDone && 'line-through text-muted-foreground')}>{domain.title}</span>
        {badge}
      </div>

      {domain.dueDate && (
        <div className="px-3 pb-1.5">
          <DueDateChip domain={domain} />
        </div>
      )}

      {children && (
        <div className="border-t border-border/50 px-3 py-1.5 text-xs text-muted-foreground line-clamp-2">
          {children}
        </div>
      )}
    </div>
  )
}
