// ============================================================
// Primitivo puro de debounce (Deuda M1, Diseño 9.2)
//
// Lógica de temporización extraída del hook useDebouncedSave para
// poder testearla sin DOM (entorno node). El hook delega en este
// primitivo; aquí vive el riesgo real (trigger/flush/cancel).
// ============================================================

export type Debouncer<T> = {
  trigger: (value: T) => void
  flush: () => void
  cancel: () => void
}

export function createDebouncer<T>(
  fn: (value: T) => Promise<void>,
  delay: number
): Debouncer<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: T | null = null

  const flush = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (pending !== null) {
      const value = pending
      pending = null
      void fn(value)
    }
  }

  return {
    trigger(value: T) {
      pending = value
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, delay)
    },
    flush,
    cancel() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      pending = null
    },
  }
}
