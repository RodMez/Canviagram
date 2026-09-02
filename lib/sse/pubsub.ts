/**
 * PubSub en memoria para SSE por workspace.
 * §7 del diseño @architect — Implementación exacta requerida.
 * - Map<string, Set<Controller>>
 * - subscribe / unsubscribe / publish con TextEncoder
 * - _clearAll / _size para tests
 * - heartbeat NO aquí (se maneja en la ruta /events)
 */

const channels = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>()

const encoder = new TextEncoder()

export const MAX_SUBSCRIBERS_PER_WORKSPACE = 100
export const MAX_WORKSPACES = 1000

export function subscribe(workspaceId: string, controller: ReadableStreamDefaultController<Uint8Array>): void {
  // Límite global de workspaces con subscribers activos
  if (!channels.has(workspaceId) && channels.size >= MAX_WORKSPACES) {
    console.warn(`[pubsub] MAX_WORKSPACES (${MAX_WORKSPACES}) excedido. Rechazando subscribe para ${workspaceId}`)
    try {
      controller.close()
    } catch {
      // ignorar error al cerrar
    }
    return
  }

  let set = channels.get(workspaceId)
  if (!set) {
    set = new Set()
    channels.set(workspaceId, set)
  }

  // Límite por workspace
  if (set.size >= MAX_SUBSCRIBERS_PER_WORKSPACE) {
    console.warn(
      `[pubsub] MAX_SUBSCRIBERS_PER_WORKSPACE (${MAX_SUBSCRIBERS_PER_WORKSPACE}) excedido para workspace ${workspaceId}`
    )
    try {
      controller.close()
    } catch {
      // ignorar
    }
    return
  }

  set.add(controller)
}

export function unsubscribe(workspaceId: string, controller: ReadableStreamDefaultController<Uint8Array>): void {
  const set = channels.get(workspaceId)
  if (!set) return
  set.delete(controller)
  if (set.size === 0) {
    channels.delete(workspaceId)
  }
}

export function publish(workspaceId: string, event: string, data: unknown): void {
  const set = channels.get(workspaceId)
  if (!set || set.size === 0) return

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  const encoded = encoder.encode(payload)

  // Usar Array.from para compatibilidad con target es5 sin downlevelIteration
  const controllers = Array.from(set)
  controllers.forEach((controller) => {
    try {
      controller.enqueue(encoded)
    } catch {
      // Si el controller está cerrado, lo removemos silenciosamente
      try {
        set.delete(controller)
      } catch {
        // ignorar
      }
    }
  })

  if (set.size === 0) {
    channels.delete(workspaceId)
  }
}

/**
 * Solo para tests: limpia todos los canales
 */
export function _clearAll(): void {
  channels.clear()
}

/**
 * Solo para tests: tamaño total de subscribers
 */
export function _size(): number {
  let total = 0
  channels.forEach((set) => {
    total += set.size
  })
  return total
}

/**
 * Solo para tests: tamaño por workspace
 */
export function _sizeByWorkspace(workspaceId: string): number {
  return channels.get(workspaceId)?.size ?? 0
}
