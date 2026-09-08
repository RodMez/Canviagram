'use client'

import { useState } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'
import type { CanvasRFEdge } from '@/lib/canvas/rf'
import type { EdgeType } from '@/lib/db/schema'
import { EdgeTypePopup } from './EdgeTypePopup'

// Colores y estilo por tipo de enlace (Fase 0): depends_on resaltado (crítico),
// parent_of punteado en azul, related_to fino/gris. El label central ya muestra
// el tipo por defecto para que los enlaces sean legibles a simple vista.
const EDGE_STYLE: Record<EdgeType, { stroke: string; strokeDasharray?: string; strokeWidth: number }> = {
  depends_on: { stroke: '#ef4444', strokeWidth: 2.5 },
  parent_of: { stroke: '#3b82f6', strokeDasharray: '7 4', strokeWidth: 2 },
  related_to: { stroke: 'var(--muted-foreground)', strokeWidth: 1 },
}

export function CustomEdge(props: EdgeProps<CanvasRFEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd } = props
  const [popup, setPopup] = useState(false)

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const domain = data?.domain
  const edgeType = domain?.type ?? 'related_to'
  const style = EDGE_STYLE[edgeType]
  const label = domain?.label ?? ''

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: style.stroke,
          strokeWidth: style.strokeWidth,
          strokeDasharray: style.strokeDasharray,
        }}
      />
      <EdgeLabelRenderer>
        <button
          onClick={() => setPopup((v) => !v)}
          className="nodrag nopan absolute -translate-x-1/2 -translate-y-1/2 rounded bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground shadow-sm hover:bg-muted"
          style={{ left: labelX, top: labelY, pointerEvents: 'all' }}
        >
          {label || edgeType.replace('_', ' ')}
        </button>
        {popup && data?.workspaceId && domain && (
          <EdgeTypePopup
            workspaceId={data.workspaceId}
            edgeId={id}
            initialType={edgeType}
            initialLabel={label}
            x={labelX}
            y={labelY}
            onClose={() => setPopup(false)}
          />
        )}
      </EdgeLabelRenderer>
    </>
  )
}
