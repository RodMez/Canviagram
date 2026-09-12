import { create } from 'zustand'
import type { BoardColumn, Node } from '@/lib/db/schema'
import type { ApplyEventPayload } from '@/lib/sse/types'
import { useCanvasStore } from '@/store/canvas-store'
import { sortColumns, mappedStatus } from '@/lib/canvas/board-columns'
import { isDemoWorkspace } from '@/lib/demo/fixtures'

type BoardState = {
  columns: BoardColumn[]
  columnsLoadedFor: string | null
  pendingMove: boolean

  setColumns: (columns: BoardColumn[], workspaceId: string) => void
  loadColumns: (workspaceId: string, columns: BoardColumn[]) => void
  applyColumnEvent: (payload: ApplyEventPayload) => void
  fetchColumns: (workspaceId: string) => Promise<void>
  moveTask: (workspaceId: string, nodeId: string, toColumnId: string, toOrder: number) => Promise<void>
  createColumn: (workspaceId: string, title: string) => Promise<BoardColumn | null>
  renameColumn: (workspaceId: string, columnId: string, title: string) => Promise<void>
  deleteColumn: (workspaceId: string, columnId: string, rehomeTo?: string) => Promise<void>
}

function normalizeColumnDates(c: BoardColumn): BoardColumn {
  const toDate = (v: unknown, fallback: Date) => {
    if (v instanceof Date && !Number.isNaN(v.getTime())) return v
    if (typeof v === 'string' || typeof v === 'number') {
      const d = new Date(v)
      if (!Number.isNaN(d.getTime())) return d
    }
    return fallback
  }
  const now = new Date()
  return {
    ...c,
    createdAt: toDate(c.createdAt, now),
    updatedAt: toDate(c.updatedAt, now),
  }
}

export const useBoardStore = create<BoardState>((set, get) => ({
  columns: [],
  columnsLoadedFor: null,
  pendingMove: false,

  setColumns: (columns, workspaceId) =>
    set({ columns: sortColumns(columns.map(normalizeColumnDates)), columnsLoadedFor: workspaceId }),

  loadColumns: (workspaceId, columns) =>
    set({ columns: sortColumns(columns.map(normalizeColumnDates)), columnsLoadedFor: workspaceId }),

  applyColumnEvent: (payload) => {
    const { event, data } = payload
    if (event === 'column:created') {
      const col = normalizeColumnDates(data as BoardColumn)
      if (get().columns.some((c) => c.id === col.id)) return
      set({ columns: sortColumns([...get().columns, col]) })
      return
    }
    if (event === 'column:updated') {
      const col = normalizeColumnDates(data as BoardColumn)
      set({ columns: sortColumns(get().columns.map((c) => (c.id === col.id ? { ...c, ...col } : c))) })
      return
    }
    if (event === 'column:deleted') {
      const { id } = data as { id: string; workspaceId: string }
      set({ columns: get().columns.filter((c) => c.id !== id) })
    }
  },

  fetchColumns: async (workspaceId) => {
    if (isDemoWorkspace(workspaceId)) return
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/board-columns`)
      if (!res.ok) throw new Error('Error cargando columnas')
      const data = (await res.json()) as { columns: BoardColumn[] }
      get().loadColumns(workspaceId, data.columns ?? [])
    } catch (err) {
      console.error('[board-store] fetchColumns failed', err)
    }
  },

  moveTask: async (workspaceId, nodeId, toColumnId, toOrder) => {
    const canvasState = useCanvasStore.getState()
    const node = canvasState.nodes.find((n) => n.id === nodeId)
    if (!node) return
    const prevSnapshot = { boardColumnId: node.boardColumnId, boardOrder: node.boardOrder, status: node.status }
    const nextStatus = mappedStatus(toColumnId, get().columns)

    // Optimista: actualiza el store de canvas de inmediato.
    useCanvasStore.setState({
      nodes: canvasState.nodes.map((n) =>
        n.id === nodeId ? { ...n, boardColumnId: toColumnId, boardOrder: toOrder, status: nextStatus } : n
      ),
    })
    set({ pendingMove: true })

    // Demo: mutación local, cero red.
    if (isDemoWorkspace(workspaceId)) {
      set({ pendingMove: false })
      return
    }
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/board/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, toColumnId, toOrder }),
      })
      if (!res.ok) throw new Error('Error moviendo tarea')
      const data = (await res.json()) as { node: Node }
      // Reconcilia con la respuesta del servidor (fuente de verdad).
      const latest = useCanvasStore.getState().nodes
      useCanvasStore.setState({
        nodes: latest.map((n) => (n.id === nodeId ? { ...n, ...data.node } : n)),
      })
    } catch (err) {
      // Rollback explícito (nada silencioso).
      console.error('[board-store] moveTask failed, rollback', err)
      const latest = useCanvasStore.getState().nodes
      useCanvasStore.setState({
        nodes: latest.map((n) => (n.id === nodeId ? { ...n, ...prevSnapshot } : n)),
      })
      throw err
    } finally {
      set({ pendingMove: false })
    }
  },

  createColumn: async (workspaceId, title) => {
    if (isDemoWorkspace(workspaceId)) {
      const col: BoardColumn = {
        id: `demo-col-${Date.now().toString(36)}`,
        workspaceId: 'demo',
        title: title.trim(),
        position: (get().columns.at(-1)?.position ?? -1000) + 1000,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      get().applyColumnEvent({ event: 'column:created', data: col })
      return col
    }
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/board-columns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Error' }))
        throw new Error(err.error || 'Error creando columna')
      }
      const data = (await res.json()) as { column: BoardColumn }
      // SSE también lo reflejará (idempotente por dedupe de id).
      get().applyColumnEvent({ event: 'column:created', data: data.column })
      return normalizeColumnDates(data.column)
    } catch (err) {
      console.error('[board-store] createColumn failed', err)
      throw err
    }
  },

  renameColumn: async (workspaceId, columnId, title) => {
    const prev = get().columns.find((c) => c.id === columnId)
    if (!prev) return
    if (isDemoWorkspace(workspaceId)) {
      get().applyColumnEvent({ event: 'column:updated', data: { ...prev, title } })
      return
    }
    // Optimista con rollback.
    get().applyColumnEvent({ event: 'column:updated', data: { ...prev, title } })
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/board-columns/${columnId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      if (!res.ok) throw new Error('Error renombrando columna')
      const data = (await res.json()) as BoardColumn
      get().applyColumnEvent({ event: 'column:updated', data })
    } catch (err) {
      console.error('[board-store] renameColumn failed, rollback', err)
      get().applyColumnEvent({ event: 'column:updated', data: prev })
      throw err
    }
  },

  deleteColumn: async (workspaceId, columnId, rehomeTo) => {
    const prevColumns = get().columns
    const prevNodes = useCanvasStore.getState().nodes
    if (isDemoWorkspace(workspaceId)) {
      // Demo: rehoming local a la primera restante.
      const remaining = prevColumns.filter((c) => c.id !== columnId)
      const dest = remaining[0]
      if (dest) {
        useCanvasStore.setState({
          nodes: prevNodes.map((n) =>
            n.boardColumnId === columnId ? { ...n, boardColumnId: dest.id } : n
          ),
        })
      }
      get().applyColumnEvent({ event: 'column:deleted', data: { id: columnId, workspaceId } })
      return
    }
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/board-columns/${columnId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rehomeTo ? { rehomeTo } : {}),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Error' }))
        throw new Error(err.error || 'Error eliminando columna')
      }
      // Refresca columnas y nodos (el rehoming mueve muchas filas).
      await get().fetchColumns(workspaceId)
      const nodesRes = await fetch(`/api/workspaces/${workspaceId}/nodes?limit=100&offset=0`)
      if (nodesRes.ok) {
        const data = (await nodesRes.json()) as { nodes: Node[] }
        useCanvasStore.getState().loadGraph(data.nodes, useCanvasStore.getState().edges)
      }
    } catch (err) {
      console.error('[board-store] deleteColumn failed', err)
      throw err
    }
  },
}))

export const selectBoardColumns = (s: BoardState) => s.columns
