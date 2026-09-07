// ============================================================
// Auto-layout (diseño 7): grilla fija, sin solapamientos.
// El servidor asigna SIEMPRE la posición de cada nodo nuevo;
// la IA/cliente no la decide (positionX/Y de entrada se ignoran).
// ============================================================

export const GRID_COLUMNS = 6
export const NODE_GRID_WIDTH = 320
export const NODE_GRID_HEIGHT = 200

/**
 * Posición del slot n-ésimo (0-based) dentro de la grilla.
 * Index = cantidad de nodos vivos del workspace antes del insert.
 */
export function positionForIndex(index: number): { x: number; y: number } {
  const safe = Number.isFinite(index) ? Math.max(0, Math.trunc(index)) : 0
  const col = safe % GRID_COLUMNS
  const row = Math.floor(safe / GRID_COLUMNS)
  return { x: col * NODE_GRID_WIDTH, y: row * NODE_GRID_HEIGHT }
}