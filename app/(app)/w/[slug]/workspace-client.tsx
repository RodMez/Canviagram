'use client'

import { useEffect, useCallback, useState } from 'react'
import { useCanvasStore } from '@/store/canvas-store'
import { useSse } from '@/hooks/useSse'
import { filterOrphanEdges } from '@/lib/canvas/rf'
import Canvas from '@/components/canvas/Canvas'
import { RightPanel } from '@/components/canvas/RightPanel'
import { Toolbar } from '@/components/canvas/Toolbar'
import { TemplatesModal } from '@/components/canvas/TemplatesModal'
import type { SseStatus } from '@/components/canvas/AiChatPanel'
import type { Node, Edge } from '@/lib/db/schema'

// Petición de abrir CreateNodePopup en el centro del viewport (botón + del Toolbar).
// Solo transporta la posición en pantalla; el flowPos lo calcula Canvas (tiene
// screenToFlowPosition dentro del ReactFlowProvider). Un solo popup, cero duplicación.
export type CreateNodeRequest = { screenPos: { x: number; y: number } }

type WorkspaceClientProps = {
  workspaceId: string
  workspaceName: string
  userId: string
  role: string
  userName: string | null
  userEmail: string | null
}

export default function WorkspaceClient({
  workspaceId,
  workspaceName,
  userId,
  role,
  userName,
  userEmail,
}: WorkspaceClientProps) {
  const loadGraph = useCanvasStore((s) => s.loadGraph)
  const [sseEnabled, setSseEnabled] = useState(false)
  const [sseStatus, setSseStatus] = useState<SseStatus>('connecting')
  const [createNodeRequest, setCreateNodeRequest] = useState<CreateNodeRequest | null>(null)
  const [templatesOpen, setTemplatesOpen] = useState(false)

  // Botón + del Toolbar → abre CreateNodePopup en el centro del viewport.
  const handleCreateNode = useCallback(() => {
    setCreateNodeRequest({
      screenPos: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    })
  }, [])

  // Carga el grafo con 2 fetches en paralelo a los endpoints EXISTENTES /nodes y /edges.
  // Filtra edges huérfanos (defensa mínima contra paginación) y llama loadGraph.
  const loadInitialGraph = useCallback(async () => {
    // Al navegar entre workspaces (sin unmount) el store conserva el grafo previo.
    // Vaciar antes de fetchear evita que el fitView one-shot de Canvas use el
    // bounding box del workspace anterior (fix canvas en blanco, alg 2024-29).
    loadGraph([], [])
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
  }, [workspaceId, loadGraph])

  // Reordenar (Fase 0): relayout del grafo a grilla limpia y refresco local.
  const handleReorder = useCallback(async () => {
    try {
      await fetch(`/api/workspaces/${workspaceId}/layout`, { method: 'POST' })
    } catch (err) {
      console.error('[workspace-client] reorder failed', err)
    }
    await loadInitialGraph()
  }, [workspaceId, loadInitialGraph])

  // Tramo de template aplicado: la respuesta la refleja SSE; recargamos el
  // grafo local para que el nuevo subgrafo entre en el store sin esperar
  // reconexiones (y el fitView one-shot encuadra los nodos nuevos).
  const handleTemplateApplied = useCallback(() => {
    setTemplatesOpen(false)
    void loadInitialGraph()
  }, [loadInitialGraph])

  useEffect(() => {
    loadInitialGraph()
  }, [loadInitialGraph])

  // Conecta SSE tras cargar el grafo (enabled se activa post-loadGraph).
  // B1: onStatus eleva el estado de conexión para el pill del chat.
  useSse({ workspaceId, enabled: sseEnabled, onStatus: setSseStatus })

  return (
    <div className="flex h-full flex-1 flex-col">
      {/* Toolbar (F3.4d): global del área autenticada, arriba del canvas (PLAN.md §6). */}
      <Toolbar
        workspaceName={workspaceName}
        onCreateNode={handleCreateNode}
        onOpenTemplates={() => setTemplatesOpen(true)}
        onReorder={handleReorder}
        userName={userName}
        userEmail={userEmail}
        workspaceId={workspaceId}
      />
      <div className="flex flex-1 overflow-hidden">
        <Canvas
          workspaceId={workspaceId}
          userId={userId}
          createNodeRequest={createNodeRequest}
          onConsumeCreateNodeRequest={() => setCreateNodeRequest(null)}
        />
        <RightPanel workspaceId={workspaceId} userId={userId} sseStatus={sseStatus} />
      </div>
      <TemplatesModal
        workspaceId={workspaceId}
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onApplied={handleTemplateApplied}
      />
    </div>
  )
}