'use client'

import { Flame, ArrowUp, Minus, ArrowDown } from 'lucide-react'
import type { NodePriority } from '@/lib/db/schema'
import { cn } from '@/lib/utils'

const PRIORITY_META: Record<NodePriority, { label: string; cls: string; Icon: typeof Flame }> = {
  urgent: { label: 'Urgente', cls: 'bg-red-500/15 text-red-600 dark:text-red-400', Icon: Flame },
  high:   { label: 'Alta',    cls: 'bg-orange-500/15 text-orange-600 dark:text-orange-400', Icon: ArrowUp },
  medium: { label: 'Media',   cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400', Icon: Minus },
  low:    { label: 'Baja',    cls: 'bg-muted text-muted-foreground', Icon: ArrowDown },
}

type Props = { priority: NodePriority | null | undefined; showLabel?: boolean }

// Chip de prioridad compartido (tarjeta del tablero, tabla y nodo del canvas).
export function PriorityBadge({ priority, showLabel = false }: Props) {
  if (!priority) return null
  const { label, cls, Icon } = PRIORITY_META[priority]
  return (
    <span title={`Prioridad: ${label}`} className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium', cls)}>
      <Icon className="h-3 w-3" />
      {showLabel ? label : null}
    </span>
  )
}