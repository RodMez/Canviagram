'use client'

import { useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { CanvasRFNode } from '@/lib/canvas/rf'
import type { NodeStatus } from '@/lib/db/schema'
import { NODE_STATUSES } from '@/lib/db/schema'
import { NodeShell } from './NodeShell'
import { cn } from '@/lib/utils'
import { patchTaskStatus } from '@/lib/canvas/task-status'
import { PriorityBadge } from '@/components/board/PriorityBadge'
import { EffortChip } from '@/components/board/EffortChip'
import { AssigneeAvatar } from '@/components/board/AssigneeAvatar'
import { useWorkspaceMembers } from '@/hooks/useWorkspaceMembers'
import { mappedStatus } from '@/lib/canvas/board-columns'
import { useBoardStore } from '@/store/board-store'
import { patchNode } from '@/lib/canvas/node-mutations'

const STATUS_STYLES: Record<NodeStatus, string> = {
  todo: 'bg-muted text-muted-foreground',
  in_progress: 'bg-accent/15 text-accent',
  done: 'bg-emerald-500/15 text-emerald-700',
}

export function TaskNode({ data }: NodeProps<CanvasRFNode>) {
  const { domain, workspaceId } = data
  const [editing, setEditing] = useState(false)
  const status = domain.status ?? 'todo'
  const columns = useBoardStore((s) => s.columns)
  const { byId: memberById } = useWorkspaceMembers(workspaceId)

  const patchStatus = (next: NodeStatus) => {
    setEditing(false)
    // Coherencia tablero↔canvas: al cambiar el status desde el nodo, la task
    // salta a la columna cuya posición mapea ese status (decisión F0/F4).
    const target = columns.find((c) => mappedStatus(c.id, columns) === next)
    if (target && domain.boardColumnId !== target.id) {
      patchNode(workspaceId, domain, { status: next, boardColumnId: target.id })
      return
    }
    patchTaskStatus(workspaceId, domain, next)
  }

  const assigneeName = domain.assigneeId
    ? memberById.get(domain.assigneeId)?.displayName ?? null
    : null

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
      <div className="flex flex-col gap-1.5">
        {domain.content ? <span className="line-clamp-2">{domain.content}</span> : null}
        {/* Indicadores enriquecidos (F5, solo lectura): prioridad, esfuerzo,
            responsable con avatar. Edición fina vía NodeDetailPanel. */}
        {(domain.priority || domain.effort != null || domain.assigneeId) && (
          <div className="flex flex-wrap items-center gap-1">
            <PriorityBadge priority={domain.priority} />
            <EffortChip effort={domain.effort} />
            {domain.assigneeId ? (
              <span className="flex items-center gap-1" title={assigneeName ?? 'Responsable'}>
                <AssigneeAvatar displayName={assigneeName} />
              </span>
            ) : null}
          </div>
        )}
      </div>
    </NodeShell>
  )
}