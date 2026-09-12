'use client'

import { useEffect, useCallback, useState } from 'react'
import { useCanvasStore } from '@/store/canvas-store'
import { useBoardStore } from '@/store/board-store'
import { useSse } from '@/hooks/useSse'
import { filterOrphanEdges } from '@/lib/canvas/rf'
import Canvas from '@/components/canvas/Canvas'
import { Board } from '@/components/board/Board'
import { TaskTable } from '@/components/board/TaskTable'
import { RightPanel } from '@/components/canvas/RightPanel'
import { Toolbar } from '@/components/canvas/Toolbar'
import type { SseStatus } from '@/components/canvas/AiChatPanel'
import type { Node, Edge } from '@/lib/db/schema'

// Petición de abrir CreateNodePopup en el centro del viewport (botón + del Toolbar).
// Solo transporta la posición en pantalla; el flowPos lo calcula Canvas (tiene
// screenToFlowPosition dentro del ReactFlowProvider). Un solo popup, cero duplicación.
export type CreateNodeRequest = { screenPos: { x: number; y: number } }

type WorkspaceClientProps = {
  workspaceId: string
  workspaceName: string
  workspaceSlug: string
  userId: string
}

type WorkspaceView = 'board' | 'table' | 'canvas'

function readWorkspaceView(): WorkspaceView | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem('canviagram:view')
    return raw === 'board' || raw === 'table' || raw === 'canvas' ? raw : null
  } catch {
    return null
  }
}

export default function WorkspaceClient({
  workspaceId,
  workspaceName,
  workspaceSlug,
  userId,
}: WorkspaceClientProps) {
  const loadGraph = useCanvasStore((s) => s.loadGraph)
  const fetchColumns = useBoardStore((s) => s.fetchColumns)
  const [sseEnabled, setSseEnabled] = useState(false)
  const [sseStatus, setSseStatus] = useState<SseStatus>('connecting')
  const [createNodeRequest, setCreateNodeRequest] = useState<CreateNodeRequest | null>(null)
  // Vista del workspace (F6.1): Tablero predeterminado; persistida en localStorage
  // para que al volver al workspace se mantenga la preferencia.
  const [view, setView] = useState<WorkspaceView>(() => readWorkspaceView() ?? 'board')

  const handleChangeView = useCallback((next: WorkspaceView) => {
    setView(next)
    try {
      localStorage.setItem('canviagram:view', next)
    } catch {
      // ignore
    }
  }, [])

  // Botón + del Toolbar → abre CreateNodePopup en el centro del viewport.
  const handleCreateNode = useCallback(() => {
    setCreateNodeRequest({
      screenPos: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    })
  }, [])

  // Carga el grafo con 2 fetches en paralelo a los endpoints EXISTENTES /nodes y
  // /edges. Filtra edges huérfanos y llama loadGraph. LAS COLUMNAS del tablero
  // viajan aparte (store separado — así no dependen del ciclo de fitView).
  const loadInitialGraph = useCallback(async () => {
    // Al navegar entre workspaces (sin unmount) el store conserva el grafo previo.
    // Vaciar antes de fetchear evita que el fitView one-shot de Canvas use el
    // bounding box del workspace anterior (fix canvas en blanco, alg 2024-29).
    loadGraph([], [])

    // Columnas: el demo se monta en DemoLanding (otra ruta); aquí es workspace
    // real. Lanzamos el fetch en PARALELO a nodos+edges (sin bloquear el grafo).
    void fetchColumns(workspaceId)

    const [nodesRes, edgesRes] = await Promise.all([
      fetch(`/api/workspaces/${workspaceId}/nodes?limit=100&offset=0`),
      fetch(`/api/workspaces/${workspaceId}/edges?limit=100&offset=0`),
    ])
    if (!nodesRes.ok || !edgesRes.ok) {
      console.error('[workspace-client] Failed to load graph')
      return
    }
    const nodesData = (await nodesRes.json()) as { nodes: Node[] }
    const edgesData = (await edgesRes.json()) as { edges: Edge[] }
    const nodes = nodesData.nodes
    const edges = filterOrphanEdges(edgesData.edges, nodes)
    loadGraph(nodes, edges)
    setSseEnabled(true)
  }, [workspaceId, loadGraph, fetchColumns])

  // Reordenar (Fase 0): relayout del grafo a grilla limpia y refresco local.
  const handleReorder = useCallback(async () => {
    try {
      await fetch(`/api/workspaces/${workspaceId}/layout`, { method: 'POST' })
    } catch (err) {
      console.error('[workspace-client] reorder failed', err)
    }
    await loadInitialGraph()
  }, [workspaceId, loadInitialGraph])

  useEffect(() => {
    loadInitialGraph()
  }, [loadInitialGraph])

  // Conecta SSE tras cargar el grafo (enabled se activa post-loadGraph).
  // B1: onStatus eleva el estado de conexión para el pill del chat.
  useSse({ workspaceId, enabled: sseEnabled, onStatus: setSseStatus })

  return (
    <div className="flex h-full flex-1 flex-col">
      {/* Barra secundaria del workspace (el header global vive en AppShell). */}
      <Toolbar
        workspaceName={workspaceName}
        workspaceSlug={workspaceSlug}
        onCreateNode={handleCreateNode}
        onReorder={handleReorder}
        workspaceId={workspaceId}
        view={view}
        onChangeView={handleChangeView}
      />
      <div className="flex flex-1 overflow-hidden">
        {view === 'board' ? (
          <Board workspaceId={workspaceId} onSwitchToCanvas={() => handleChangeView('canvas')} />
        ) : view === 'table' ? (
          <TaskTable workspaceId={workspaceId} />
        ) : (
          <Canvas
            workspaceId={workspaceId}
            userId={userId}
            createNodeRequest={createNodeRequest}
            onConsumeCreateNodeRequest={() => setCreateNodeRequest(null)}
          />
        )}
        <RightPanel workspaceId={workspaceId} userId={userId} sseStatus={sseStatus} />
      </div>
    </div>
  )
}