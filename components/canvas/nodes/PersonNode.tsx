import type { NodeProps } from '@xyflow/react'
import type { CanvasRFNode } from '@/lib/canvas/rf'
import { NodeShell } from './NodeShell'

export function PersonNode({ data }: NodeProps<CanvasRFNode>) {
  const { domain } = data
  return (
    <NodeShell domain={domain}>
      {domain.content ? <span className="line-clamp-1">{domain.content}</span> : null}
    </NodeShell>
  )
}
