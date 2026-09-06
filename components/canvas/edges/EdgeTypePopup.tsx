'use client'

import { useEffect, useState } from 'react'
import type { EdgeType } from '@/lib/db/schema'
import { EDGE_TYPES } from '@/lib/db/schema'
import { cn } from '@/lib/utils'
import { useCanvasStore } from '@/store/canvas-store'
import { isDemoWorkspace } from '@/lib/demo/fixtures'

type EdgeTypePopupProps = {
  workspaceId: string
  edgeId: string
  initialType: EdgeType
  initialLabel: string
  x: number
  y: number
  onClose: () => void
}

export function EdgeTypePopup({
  workspaceId,
  edgeId,
  initialType,
  initialLabel,
  x,
  y,
  onClose,
}: EdgeTypePopupProps) {
  const [type, setType] = useState<EdgeType>(initialType)
  const [label, setLabel] = useState(initialLabel)
  const [busy, setBusy] = useState(false)
  const applyLocalEvent = useCanvasStore((s) => s.applyLocalEvent)
  const isDemo = isDemoWorkspace(workspaceId)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-edge-popup]')) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  const run = async (method: 'PATCH' | 'DELETE') => {
    setBusy(true)
    try {
      // Demo (F4.1): PATCH/DELETE locales vía applyLocalEvent, cero fetch.
      if (isDemo) {
        if (method === 'PATCH') {
          applyLocalEvent({
            event: 'edge:updated',
            data: { id: edgeId, type, label: label || null },
          })
        } else {
          applyLocalEvent({ event: 'edge:deleted', data: { id: edgeId, workspaceId: 'demo' } })
        }
        onClose()
        return
      }
      const res = await fetch(`/api/workspaces/${workspaceId}/edges/${edgeId}`, {
        method,
        headers: method === 'PATCH' ? { 'Content-Type': 'application/json' } : undefined,
        body: method === 'PATCH' ? JSON.stringify({ type, label: label || null }) : undefined,
      })
      if (!res.ok) throw new Error('Error en edge')
      onClose()
    } catch (err) {
      console.error('[EdgeTypePopup] failed', err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      data-edge-popup
      className="nodrag nopan absolute z-50 w-56 -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-popover p-3 shadow-lg"
      style={{ left: x, top: y, pointerEvents: 'all' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex flex-col gap-1">
        {EDGE_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={cn(
              'rounded px-2 py-1 text-left text-xs font-medium',
              t === type ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
            )}
          >
            {t.replace('_', ' ')}
          </button>
        ))}
      </div>
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Etiqueta (opcional)"
        className="mb-2 w-full rounded border bg-background px-2 py-1 text-xs"
      />
      <div className="flex gap-2">
        <button
          onClick={() => run('PATCH')}
          disabled={busy}
          className="flex-1 rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          Guardar
        </button>
        <button
          onClick={() => run('DELETE')}
          disabled={busy}
          className="rounded bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground disabled:opacity-50"
        >
          Eliminar
        </button>
      </div>
    </div>
  )
}
