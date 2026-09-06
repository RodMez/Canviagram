import { create } from 'zustand'
import type { Node, Edge } from '@/lib/db/schema'
import type { SSEEventName, ApplyEventPayload } from '@/lib/sse/types'
import { applyCanvasEvent } from '@/lib/canvas/reducer'

// ============================================================
// State shape
// ============================================================

type CanvasState = {
  // Data
  nodes: Node[]
  edges: Edge[]

  // UI state (persisted in localStorage)
  selectedNodeId: string | null
  isPanelCollapsed: boolean
  demoMode: boolean

  // Actions
  setNodes: (nodes: Node[]) => void
  setEdges: (edges: Edge[]) => void
  loadGraph: (nodes: Node[], edges: Edge[]) => void
  applyEvent: (payload: ApplyEventPayload) => void
  /** Demo bus (F4.1): aplica mutaciones locales SIN el guard de demoMode. */
  applyLocalEvent: (payload: ApplyEventPayload) => void
  selectNode: (nodeId: string | null) => void
  togglePanel: () => void
  setDemoMode: (enabled: boolean) => void
}

// ============================================================
// Helpers
// ============================================================

function readPanelCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem('canviagram:panel-collapsed') === '1'
  } catch {
    return false
  }
}

function writePanelCollapsed(collapsed: boolean): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem('canviagram:panel-collapsed', collapsed ? '1' : '0')
  } catch {
    // ignore
  }
}

// ============================================================
// Store
// ============================================================

export const useCanvasStore = create<CanvasState>((set, get) => ({
  // Initial state
  nodes: [],
  edges: [],
  selectedNodeId: null,
  isPanelCollapsed: readPanelCollapsed(),
  demoMode: false,

  // Actions
  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),

  loadGraph: (nodes, edges) => set({ nodes, edges }),

  applyEvent: (payload) => {
    const state = get()

    // Si es demoMode, ignorar eventos del servidor
    if (state.demoMode) return

    set(applyCanvasEvent(state, payload))
  },

  // Demo bus (F4.1): mismo reducer puro que applyEvent, pero SIN el guard
  // de demoMode — es el canal de todas las mutaciones locales del demo
  // (chat IA, drag-connect, popup crear/editar/borrar).
  applyLocalEvent: (payload) => {
    set(applyCanvasEvent(get(), payload))
  },

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

  togglePanel: () => {
    const next = !get().isPanelCollapsed
    writePanelCollapsed(next)
    set({ isPanelCollapsed: next })
  },

  setDemoMode: (enabled) => set({ demoMode: enabled }),
}))

// ============================================================
// Selectors (memoization helpers para F3.4)
// ============================================================

export const selectNodes = (state: CanvasState) => state.nodes
export const selectEdges = (state: CanvasState) => state.edges
export const selectSelectedNode = (state: CanvasState) =>
  state.nodes.find((n) => n.id === state.selectedNodeId) ?? null