'use client'

import { Handle, Position } from '@xyflow/react'
import type { ReactNode } from 'react'
import type { Node as DBNode } from '@/lib/db/schema'
import { NODE_META } from '@/lib/canvas/node-meta'
import { cn } from '@/lib/utils'

type NodeShellProps = {
  domain: DBNode
  children?: ReactNode
  /** Optional badge rendered next to the type label */
  badge?: ReactNode
}

export function NodeShell({ domain, children, badge }: NodeShellProps) {
  const meta = NODE_META[domain.type]
  const Icon = meta.icon

  return (
    <div
      className={cn(
        'rounded-xl border bg-card shadow-sm min-w-[160px] max-w-[260px] text-sm',
        meta.accent,
      )}
    >
      <Handle type="target" position={Position.Left} className="!w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!w-2 !h-2" />

      <div className="flex items-center gap-2 px-3 py-2">
        <Icon className="h-4 w-4 shrink-0 opacity-80" />
        <span className="font-medium truncate">{domain.title}</span>
        {badge}
      </div>

      {children && (
        <div className="border-t border-border/50 px-3 py-1.5 text-xs text-muted-foreground line-clamp-2">
          {children}
        </div>
      )}
    </div>
  )
}
