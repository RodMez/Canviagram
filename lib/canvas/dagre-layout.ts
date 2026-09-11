import dagre from '@dagrejs/dagre'

// ============================================================
// Layout jerárquico del canvas con dagre (F5.2).
//
// Reemplaza el volcado secuencial en grilla de `relayoutWorkspace`:
// los edges dirigidos (depends_on / parent_of) se mapean 1:1 al
// rank de dagre (Sugiyama), así lo relacionado queda agrupado
// visualmente y las dependencias fluyen de arriba hacia abajo.
//
// `positionForIndex`/`occupiedIndex`/`findFreeSlots` (layout.ts) se
// mantienen: `createNode` los sigue usando para el slot inicial.
// ============================================================

// NodeShell real: min-w-[160px] max-w-[260px], altura variable según
// contenido (~60-110px). 220x100 es el punto medio con margen; si hay
// solapes visuales, ajustar aquí (exportadas a propósito).
export const DAGRE_NODE_WIDTH = 220
export const DAGRE_NODE_HEIGHT = 100
export const DAGRE_RANK_SEP = 90
export const DAGRE_NODE_SEP = 60

export type DagreEdgeInput = { sourceId: string; targetId: string }

/**
 * Calcula posiciones 2D para todos los nodos dados.
 * - `rankdir: 'TB'`: lo que depende de algo queda debajo.
 * - Componentes desconectados: dagre los distribuye de forma nativa.
 * - Grafos con ciclos: dagre rompe ciclos internamente (Sugiyama).
 * - dagre centra el nodo en (x,y); se convierte a esquina
 *   superior-izquierda (sistema de React Flow).
 */
export function computeDagreLayout(
  nodeIds: string[],
  edges: DagreEdgeInput[]
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', ranksep: DAGRE_RANK_SEP, nodesep: DAGRE_NODE_SEP })
  g.setDefaultEdgeLabel(() => ({}))

  for (const id of nodeIds) {
    g.setNode(id, { width: DAGRE_NODE_WIDTH, height: DAGRE_NODE_HEIGHT })
  }
  for (const e of edges) {
    if (e.sourceId !== e.targetId && g.hasNode(e.sourceId) && g.hasNode(e.targetId)) {
      g.setEdge(e.sourceId, e.targetId)
    }
  }

  dagre.layout(g)

  const result = new Map<string, { x: number; y: number }>()
  for (const id of nodeIds) {
    const pos = g.node(id)
    result.set(id, { x: pos.x - DAGRE_NODE_WIDTH / 2, y: pos.y - DAGRE_NODE_HEIGHT / 2 })
  }
  return result
}
