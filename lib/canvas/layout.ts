// ============================================================
// Auto-layout (diseño 7): grilla fija, sin solapamientos.
// El servidor asigna SIEMPRE la posición de cada nodo nuevo;
// la IA/cliente no la decide (positionX/Y de entrada se ignoran).
// ============================================================

export const GRID_COLUMNS = 6
export const NODE_GRID_WIDTH = 320
export const NODE_GRID_HEIGHT = 200

/** Columna/fila del slot n-ésimo (0-based) dentro de la grilla. */
export function slotForIndex(index: number): { col: number; row: number } {
  const safe = Number.isFinite(index) ? Math.max(0, Math.trunc(index)) : 0
  return { col: safe % GRID_COLUMNS, row: Math.floor(safe / GRID_COLUMNS) }
}

/**
 * Posición del slot n-ésimo (0-based) dentro de la grilla.
 */
export function positionForIndex(index: number): { x: number; y: number } {
  const { col, row } = slotForIndex(index)
  return { x: col * NODE_GRID_WIDTH, y: row * NODE_GRID_HEIGHT }
}

/**
 * Índice de slot que "ocupa" una posición arbitraria (nodos arrastrados o
 * reposicionados). Se usa para detectar colisiones post-borrado/post-drag:
 * el slot se redondea al celdado de la grilla, de modo que dos nodos dentro
 * de la misma celda comparten slot (y no se les reasigna uno ocupado).
 */
export function occupiedIndex(x: number, y: number): number {
  const col = Math.max(0, Math.floor(x / NODE_GRID_WIDTH))
  const row = Math.max(0, Math.floor(y / NODE_GRID_HEIGHT))
  return row * GRID_COLUMNS + col
}

/**
 * Devuelve `count` índices de slot libres (row-major, desde startIndex).
 * Evita reutilizar slots ocupados — corrección del bug de solape donde el
 * "uso del conteo de nodos vivos como índice" re-colocaba nodos encima de
 * otros tras borrados o drags.
 */
export function findFreeSlots(occupied: Set<number>, count: number, startIndex = 0): number[] {
  const slots: number[] = []
  let idx = Number.isFinite(startIndex) ? Math.max(0, Math.trunc(startIndex)) : 0
  while (slots.length < count) {
    if (!occupied.has(idx)) slots.push(idx)
    idx++
  }
  return slots
}