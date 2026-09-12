'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useCanvasStore } from '@/store/canvas-store'
import { useBoardStore } from '@/store/board-store'
import type { SSEEventName } from '@/lib/sse/types'

// ============================================================
// Configuración backoff
// ============================================================

const BACKOFF_BASE_MS = 1_000
const BACKOFF_MAX_MS = 30_000
const MAX_RETRIES = 20

// ============================================================
// Hook
// ============================================================

type SseStatus = 'connecting' | 'connected' | 'disconnected'

type UseSseOptions = {
  workspaceId: string
  onEvent?: (event: SSEEventName, data: unknown) => void
  onStatus?: (status: SseStatus) => void // NUEVO (B1, opcional, no rompe callers)
  enabled?: boolean
}

export function useSse({ workspaceId, onEvent, onStatus, enabled = true }: UseSseOptions) {
  const retryCount = useRef(0)
  const eventSourceRef = useRef<EventSource | null>(null)
  const applyEvent = useCanvasStore((s) => s.applyEvent)

  const connect = useCallback(() => {
    if (!enabled || !workspaceId) return

    // Cerrar conexión anterior si existe
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    const url = `/api/workspaces/${encodeURIComponent(workspaceId)}/events`
    const es = new EventSource(url, { withCredentials: true })
    eventSourceRef.current = es

    // B1: notificar estado inicial al intentar conectar.
    onStatus?.('connecting')

    es.onopen = () => {
      retryCount.current = 0 // Reset backoff en conexión exitosa
      onStatus?.('connected')
    }

    // Escuchar todos los eventos de canvas + tablero
    const events: SSEEventName[] = [
      'node:created',
      'node:updated',
      'node:deleted',
      'edge:created',
      'edge:updated',
      'edge:deleted',
      'column:created',
      'column:updated',
      'column:deleted',
    ]

    events.forEach((eventName) => {
      es.addEventListener(eventName, ((e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data)
          if (eventName.startsWith('column:')) {
            useBoardStore.getState().applyColumnEvent({ event: eventName, data })
          } else {
            applyEvent({ event: eventName, data })
          }
          onEvent?.(eventName, data)
        } catch {
          console.warn('[useSse] Failed to parse event data:', e.data)
        }
      }) as EventListener)
    })

    // Evento connected ( del handshake)
    es.addEventListener('connected', (() => {
      console.log('[useSse] Connected to workspace:', workspaceId)
    }) as EventListener)

    es.onerror = () => {
      es.close()
      eventSourceRef.current = null

      // B1: notificar desconexión tras cerrar y antes de programar backoff.
      onStatus?.('disconnected')

      // Exponential backoff con jitter
      if (retryCount.current < MAX_RETRIES) {
        const delay = Math.min(
          BACKOFF_BASE_MS * Math.pow(2, retryCount.current) + Math.random() * 500,
          BACKOFF_MAX_MS
        )
        retryCount.current++
        console.log(`[useSse] Reconnecting in ${Math.round(delay)}ms (attempt ${retryCount.current})`)
        setTimeout(connect, delay)
      }
    }
  }, [workspaceId, enabled, applyEvent, onEvent, onStatus])

  useEffect(() => {
    connect()

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
    }
  }, [connect])
}