'use client'

import { useRef, useCallback, useEffect, useState } from 'react'
import { createDebouncer } from '@/lib/utils/debounce'

// ============================================================
// Hook genérico de debounce con estado de guardado
//
// Refactor (Deuda M1, Diseño 9.2): la temporización se delega en
// el primitivo puro createDebouncer (testable sin DOM). El hook
// conserva su API pública { trigger, flush, cancel, status } y el
// estado saving/saved con auto-reset a idle tras 2s.
//
// Deuda persistente documentada: el render-test del hook (estado
// saving/saved + auto-reset) requiere jsdom/@testing-library; se
// deja como mejora futura de bajo valor. La lógica crítica
// (debounce/flush/cancel) se cubre en el primitivo puro.
// ============================================================

type UseDebouncedSaveOptions<T> = {
  fn: (value: T) => Promise<void>
  delay: number
  deps?: unknown[]
}

type UseDebouncedSaveReturn<T> = {
  trigger: (value: T) => void
  flush: () => void
  cancel: () => void
  status: 'idle' | 'saving' | 'saved'
}

export function useDebouncedSave<T>({
  fn,
  delay,
  deps = [],
}: UseDebouncedSaveOptions<T>): UseDebouncedSaveReturn<T> {
  const mountedRef = useRef(true)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')

  const executeSave = useCallback(
    async (value: T) => {
      if (!mountedRef.current) return
      setStatus('saving')
      try {
        await fn(value)
        if (mountedRef.current) {
          setStatus('saved')
          // Auto-reset a idle después de 2s
          setTimeout(() => {
            if (mountedRef.current) setStatus('idle')
          }, 2000)
        }
      } catch (error) {
        console.error('[useDebouncedSave] Save failed:', error)
        if (mountedRef.current) setStatus('idle')
      }
    },
    [fn]
  )

  // Referencia mutable a la última executeSave: el debouncer se crea una vez
  // (o al cambiar delay) y siempre invoca la versión más reciente de fn sin
  // recrearse en cada render (evita cancelar guardados pendientes).
  const executeSaveRef = useRef(executeSave)
  executeSaveRef.current = executeSave

  const debouncerRef = useRef<ReturnType<typeof createDebouncer<T>> | null>(null)
  const delayRef = useRef(delay)
  if (!debouncerRef.current || delayRef.current !== delay) {
    delayRef.current = delay
    debouncerRef.current?.cancel()
    debouncerRef.current = createDebouncer(
      (value: T) => executeSaveRef.current(value),
      delay
    )
  }

  // Cleanup on unmount: flushea pendientes ANTES de marcar desmontado
  // (B3, Diseño 11.2 — mantener flush on unmount) para no orfanar guardados.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      debouncerRef.current?.flush()
      mountedRef.current = false
    }
  }, [])

  const trigger = useCallback((value: T) => {
    debouncerRef.current?.trigger(value)
  }, [])

  const flush = useCallback(() => {
    debouncerRef.current?.flush()
  }, [])

  const cancel = useCallback(() => {
    debouncerRef.current?.cancel()
    setStatus('idle')
  }, [])

  return { trigger, flush, cancel, status }
}

// ============================================================
// Helpers de uso común para F3.4
// ============================================================

/**
 * PATCH genérico para actualizar un nodo desde NodeDetailPanel
 * Uso: useDebouncedSave({ fn: saveNode, delay: 500 })
 */
export function createNodeSaveFn(
  workspaceId: string,
  nodeId: string,
  userId: string
) {
  return async (updates: Record<string, unknown>) => {
    const res = await fetch(`/api/workspaces/${workspaceId}/nodes/${nodeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Error' }))
      throw new Error(err.error || 'Error guardando')
    }
  }
}

/**
 * PATCH para actualizar posición (drag en canvas)
 * Uso: useDebouncedSave({ fn: savePosition, delay: 300 })
 */
export function createPositionSaveFn(
  workspaceId: string,
  nodeId: string
) {
  return async (position: { positionX: number; positionY: number }) => {
    const res = await fetch(`/api/workspaces/${workspaceId}/nodes/${nodeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(position),
    })
    if (!res.ok) throw new Error('Error guardando posición')
  }
}