'use client'

import { useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { CanvasRFNode } from '@/lib/canvas/rf'
import type { NodeStatus } from '@/lib/db/schema'
import { NODE_STATUSES } from '@/lib/db/schema'
import { NodeShell } from './NodeShell'
import { cn } from '@/lib/utils'
import { useCanvasStore } from '@/store/canvas-store'
import { isDemoWorkspace } from '@/lib/demo/fixtures'

const STATUS_STYLES: Record<NodeStatus, string> = {
  todo: 'bg-muted text-muted-foreground',
  in_progress: 'bg-accent/15 text-accent',
  done: 'bg-emerald-500/15 text-emerald-700',
}

export function TaskNode({ data }: NodeProps<CanvasRFNode>) {
  const { domain, workspaceId } = data
  const [editing, setEditing] = useState(false)
  const status = domain.status ?? 'todo'
  const applyLocalEvent = useCanvasStore((s) => s.applyLocalEvent)

  const patchStatus = (next: NodeStatus) => {
    setEditing(false)
    // Demo (F4.1): cambio de status local, cero PATCH.
    if (isDemoWorkspace(workspaceId)) {
      applyLocalEvent({ event: 'node:updated', data: { ...domain, status: next } })
      return
    }
    fetch(`/api/workspaces/${workspaceId}/nodes/${domain.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    }).catch((err) => console.error('[TaskNode] status patch failed', err))
  }

  const badge = editing ? (
    <div className="nodrag flex gap-1">
      {NODE_STATUSES.map((s) => (
        <button
          key={s}
          onClick={() => patchStatus(s)}
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px] font-medium',
            STATUS_STYLES[s],
            s === status && 'ring-1 ring-ring',
          )}
        >
          {s.replace('_', ' ')}
        </button>
      ))}
    </div>
  ) : (
    <button
      onClick={() => setEditing(true)}
      className={cn('nodrag rounded px-1.5 py-0.5 text-[10px] font-medium', STATUS_STYLES[status])}
    >
      {status.replace('_', ' ')}
    </button>
  )

  return (
    <NodeShell domain={domain} badge={badge}>
      {domain.content ? <span className="line-clamp-2">{domain.content}</span> : null}
    </NodeShell>
  )
}
