'use client'

import { useMemo, useCallback, useRef, useState, useEffect } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  useReactFlow,
  type Node as RFNode,
  type Connection,
  type OnSelectionChangeParams,
  type NodeChange,
} from '@xyflow/react'
import { useCanvasStore, selectNodes, selectEdges } from '@/store/canvas-store'
import { storeToRfNodes, storeToRfEdges } from '@/lib/canvas/rf'
import { createPositionSaveFn } from '@/hooks/useDebouncedSave'
import { nodeTypes, edgeTypes } from './nodes'
import { CreateNodePopup } from './CreateNodePopup'
import { isDemoWorkspace, demoId } from '@/lib/demo/fixtures'
import type { Edge } from '@/lib/db/schema'
import type { CreateNodeRequest } from '@/app/(app)/w/[slug]/workspace-client'

type CanvasProps = {
  workspaceId: string
  userId: string
  /** Petición del Toolbar (+) para abrir el popup en el centro del viewport. */
  createNodeRequest?: CreateNodeRequest | null
  /** Consume la petición tras abrir el popup (el padre la resetea). */
  onConsumeCreateNodeRequest?: () => void
}

type CreatePopupState = {
  screenPos: { x: number; y: number }
  flowPos: { x: number; y: number }
}

export default function Canvas({
  workspaceId,
  userId,
  createNodeRequest,
  onConsumeCreateNodeRequest,
}: CanvasProps) {
  return (
    <div className="relative flex-1 overflow-hidden">
      <ReactFlowProvider>
        <CanvasInner
          workspaceId={workspaceId}
          userId={userId}
          createNodeRequest={createNodeRequest}
          onConsumeCreateNodeRequest={onConsumeCreateNodeRequest}
        />
      </ReactFlowProvider>
    </div>
  )
}

function CanvasInner({
  workspaceId,
  userId,
  createNodeRequest,
  onConsumeCreateNodeRequest,
}: CanvasProps) {
  const nodes = useCanvasStore(selectNodes)
  const edges = useCanvasStore(selectEdges)
  const setNodes = useCanvasStore((s) => s.setNodes)
  const selectNode = useCanvasStore((s) => s.selectNode)
  const applyLocalEvent = useCanvasStore((s) => s.applyLocalEvent)
  const { screenToFlowPosition, fitView } = useReactFlow()
  const isDemo = isDemoWorkspace(workspaceId)

  const [createPopup, setCreatePopup] = useState<CreatePopupState | null>(null)
  const lastPaneClickRef = useRef<{ time: number; x: number; y: number } | null>(null)

  // Fit one-shot cuando el grafo carga (fix canvas "en blanco"): el prop fitView
  // de ReactFlow solo corre al montar, cuando el store aún está vacío (0 nodos),
  // y los nodos server-side (auto-layout) quedan fuera del viewport. Al aparecer
  // el primer batch hacemos un fitView breve; el ref por workspaceId evita pisar
  // el viewport del usuario en cargas posteriores (SSE, nuevos nodos, etc.).
  const fittedWorkspaceRef = useRef<string | null>(null)
  useEffect(() => {
    if (nodes.length === 0) return
    const t = setTimeout(() => {
      if (fittedWorkspaceRef.current === workspaceId) return
      fittedWorkspaceRef.current = workspaceId
      fitView({ duration: 200, padding: 0.2 })
    }, 60)
    return () => clearTimeout(t)
  }, [workspaceId, nodes.length, fitView])

  // Store → React Flow (vista derivada, unidireccional). Zustand es la fuente única.
  const rfNodes = useMemo(() => storeToRfNodes(nodes, workspaceId), [nodes, workspaceId])
  const rfEdges = useMemo(() => storeToRfEdges(edges, workspaceId), [edges, workspaceId])

  // RF → Store: escribe la posición real en el store y persiste con PATCH (debounce en F3.4d).
  const handleNodeDragStop = useCallback(
    (_event: MouseEvent | TouchEvent, node: RFNode) => {
      const position = { positionX: node.position.x, positionY: node.position.y }
      setNodes(
        nodes.map((n) =>
          n.id === node.id ? { ...n, positionX: position.positionX, positionY: position.positionY } : n
        )
      )
      // Demo (F4.1): la posición ya quedó en el store; sin PATCH (cero DB).
      if (isDemo) return
      createPositionSaveFn(workspaceId, node.id)(position).catch((err) => {
        console.error('[Canvas] position save failed', err)
      })
    },
    [nodes, setNodes, workspaceId, isDemo]
  )

  // RF → Store (Follow-up 3, Diseño 4.3): refleja la posición del nodo en el store
  // DURANTE el arrastre. Sin esto, un re-render (ej. evento SSE) a mitad del drag
  // resetea el nodo a su posición previa y "rebota". Solo se persiste en
  // onNodeDragStop (ya existe). Ignoramos selection/remove (la selección la
  // gobierna el store) y dimensions (el store no las trackea).
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const positionChanges = changes.filter((c) => c.type === 'position')
      if (positionChanges.length === 0) return
      setNodes(
        nodes.map((n) => {
          const change = positionChanges.find((c) => c.id === n.id)
          if (change?.type === 'position' && change.position) {
            return { ...n, positionX: change.position.x, positionY: change.position.y }
          }
          return n
        })
      )
    },
    [nodes, setNodes]
  )

  // RF → Store: POST edge; la respuesta la refleja SSE (edge:created) — no duplicar a mano.
  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return
      // Demo (F4.1): publish local — edge efímero en el store, cero DB/SSE.
      if (isDemo) {
        const edge: Edge = {
          id: demoId('e'),
          workspaceId: 'demo',
          createdBy: 'demo',
          sourceId: connection.source,
          targetId: connection.target,
          type: 'related_to',
          label: null,
          createdAt: new Date(),
        }
        applyLocalEvent({ event: 'edge:created', data: edge })
        return
      }
      fetch(`/api/workspaces/${workspaceId}/edges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: connection.source,
          targetId: connection.target,
          type: 'related_to',
        }),
      }).catch((err) => {
        console.error('[Canvas] connect failed', err)
      })
    },
    [workspaceId, isDemo, applyLocalEvent]
  )

  // RF → Store: la selección la gobierna el store (selectedNodeId).
  const handleSelectionChange = useCallback(
    ({ nodes: selected }: OnSelectionChangeParams) => {
      selectNode(selected[0]?.id ?? null)
    },
    [selectNode]
  )

  // Doble clic en el lienzo vacío → abre CreateNodePopup en esa posición.
  // React Flow v12 no expone onPaneDoubleClick; detectamos doble clic sobre onPaneClick.
  const handlePaneClick = useCallback(
    (event: React.MouseEvent) => {
      const now = Date.now()
      const last = lastPaneClickRef.current
      lastPaneClickRef.current = { time: now, x: event.clientX, y: event.clientY }
      if (last && now - last.time < 300 && Math.abs(last.x - event.clientX) < 8 && Math.abs(last.y - event.clientY) < 8) {
        lastPaneClickRef.current = null
        const screenPos = { x: event.clientX, y: event.clientY }
        setCreatePopup({ screenPos, flowPos: screenToFlowPosition(screenPos) })
      }
    },
    [screenToFlowPosition]
  )

  // Botón + del Toolbar → abre el MISMO CreateNodePopup en el centro del viewport.
  // El flowPos se calcula aquí (dentro del ReactFlowProvider) y se consume la petición.
  useEffect(() => {
    if (!createNodeRequest) return
    const screenPos = createNodeRequest.screenPos
    setCreatePopup({ screenPos, flowPos: screenToFlowPosition(screenPos) })
    onConsumeCreateNodeRequest?.()
  }, [createNodeRequest, screenToFlowPosition, onConsumeCreateNodeRequest])

  return (
    <>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: 'related_to', markerEnd: { type: MarkerType.ArrowClosed } }}
        onNodeDragStop={handleNodeDragStop}
        onNodesChange={handleNodesChange}
        onConnect={handleConnect}
        onSelectionChange={handleSelectionChange}
        onPaneClick={handlePaneClick}
        deleteKeyCode={['Backspace', 'Delete']}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
      <CreateNodePopup
        screenPos={createPopup?.screenPos ?? null}
        flowPos={createPopup?.flowPos ?? { x: 0, y: 0 }}
        workspaceId={workspaceId}
        onClose={() => setCreatePopup(null)}
      />
    </>
  )
}
