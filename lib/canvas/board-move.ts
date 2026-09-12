import { BOARD_ORDER_GAP } from './board-columns'

/**
 * Calcula el boardOrder para insertar entre dos vecinos ordenados.
 * - Sin vecinos (columna vacía) → BOARD_ORDER_GAP (1000).
 * - Solo next (insert al inicio) → next - GAP.
 * - Solo prev (append al final) → prev + GAP.
 * - Ambos → punto medio. Si el gap colapsa (< 0.001), el llamador debe
 *   renormalizar la columna con `renormalizeOrders` (gaps *1000).
 */
export function computeBoardOrder(
  prevOrder: number | null,
  nextOrder: number | null
): number {
  if (prevOrder == null && nextOrder == null) return BOARD_ORDER_GAP
  if (prevOrder == null && nextOrder != null) return nextOrder - BOARD_ORDER_GAP
  if (prevOrder != null && nextOrder == null) return prevOrder + BOARD_ORDER_GAP
  return (prevOrder! + nextOrder!) / 2
}

/** True si dos órdenes están tan cerca que conviene renormalizar. */
export function needsRenormalize(prevOrder: number, nextOrder: number): boolean {
  return Math.abs(nextOrder - prevOrder) < 0.001
}

/**
 * Dado un array de órdenes YA ordenado asc y un índice destino (0..len),
 * resuelve (prev, next) para `computeBoardOrder`. Clampea el índice.
 */
export function neighboursForIndex(
  sortedOrders: number[],
  toIndex: number
): { prev: number | null; next: number | null } {
  const idx = Math.max(0, Math.min(toIndex, sortedOrders.length))
  return {
    prev: idx > 0 ? sortedOrders[idx - 1] : null,
    next: idx < sortedOrders.length ? sortedOrders[idx] : null,
  }
}

/**
 * Orden para mover una tarjeta a `toIndex` dentro de una columna cuyos
 * órdenes (excluyendo la tarjeta en movimiento si ya estaba ahí) son
 * `sortedOrders`. Puro y testeable sin DB.
 */
export function orderForMoveToIndex(
  sortedOrdersWithoutMoving: number[],
  toIndex: number
): number {
  const { prev, next } = neighboursForIndex(sortedOrdersWithoutMoving, toIndex)
  return computeBoardOrder(prev, next)
}

/**
 * Renormaliza una columna a gaps *1000 preservando el orden relativo.
 * Devuelve lista de {id, boardOrder} lista para persistir en tx.
 */
export function renormalizeOrders<T extends { id: string; boardOrder: number }>(
  tasksSorted: T[]
): { id: string; boardOrder: number }[] {
  return tasksSorted.map((t, i) => ({ id: t.id, boardOrder: (i + 1) * BOARD_ORDER_GAP }))
}
