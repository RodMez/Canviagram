'use client'

import { useEffect, useRef, useState } from 'react'
import { NODE_TYPES, type NodeType, type NodeStatus, type Node as DbNode } from '@/lib/db/schema'
import { useCanvasStore } from '@/store/canvas-store'
import { isDemoWorkspace, demoId } from '@/lib/demo/fixtures'

type CreateNodePopupProps = {
  /** Posición en pantalla (clientX/clientY) para anclar el DOM del popup. */
  screenPos: { x: number; y: number } | null
  /** Posición en coordenadas de flujo para el nodo (positionX/positionY). */
  flowPos: { x: number; y: number }
  workspaceId: string
  onClose: () => void
  /** Tipo pre-seleccionado (ej. el "+" de una columna del Tablero pasa 'task'). */
  initialType?: NodeType
  /** Status pre-seleccionado (el "+" de una columna pasa el status de esa columna). */
  initialStatus?: NodeStatus
}

// Popup crear nodo (Diseño 12.4): título + descripción + tipo → POST /nodes.
// La respuesta la refleja SSE (node:created); el popup NO duplica el insert.
// Modo demo (F4.1): publish local vía applyLocalEvent, cero fetch.
export function CreateNodePopup({ screenPos, flowPos, workspaceId, onClose, initialType = 'task', initialStatus = 'todo' }: CreateNodePopupProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<NodeType>(initialType)
  const [status, setStatus] = useState<NodeStatus>(initialStatus ?? 'todo')
  const [busy, setBusy] = useState(false)
  const creatingRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const applyLocalEvent = useCanvasStore((s) => s.applyLocalEvent)
  const isDemo = isDemoWorkspace(workspaceId)

  useEffect(() => inputRef.current?.focus(), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!screenPos) return null

  const create = async () => {
    const trimmed = title.trim()
    if (!trimmed || creatingRef.current) return
    creatingRef.current = true
    setBusy(true)
    try {
      // Demo (F4.1): nodo efímero en el store, cero DB.
      if (isDemo) {
        const node: DbNode = {
          id: demoId('n'),
          workspaceId: 'demo',
          createdBy: 'demo',
          type,
          title: trimmed,
          content: description.trim() || null,
          status: type === 'task' ? status : null,
          dueDate: null,
          reminderOffsetMin: null,
          notifiedAt: null,
          recurrenceRule: null,
          positionX: flowPos.x,
          positionY: flowPos.y,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        }
        applyLocalEvent({ event: 'node:created', data: node })
        onClose()
        return
      }
      const res = await fetch(`/api/workspaces/${workspaceId}/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: trimmed,
          type,
          content: description.trim() || null,
          positionX: flowPos.x,
          positionY: flowPos.y,
          ...(type === 'task' ? { status } : {}),
        }),
      })
      if (!res.ok) throw new Error('Error al crear nodo')
      onClose()
    } catch (err) {
      console.error('[CreateNodePopup] create failed', err)
    } finally {
      creatingRef.current = false
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed z-50 w-64 rounded-lg border bg-popover p-3 shadow-lg"
      style={{ left: screenPos.x, top: screenPos.y }}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        // Crea al salir del popup (blur), pero no al interactuar con sus controles internos.
        if (!e.currentTarget.contains(e.relatedTarget as Node)) create()
      }}
    >
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && create()}
        placeholder="Título del nodo"
        className="mb-2 w-full rounded border bg-background px-2 py-1 text-sm"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && create()}
        placeholder="Descripción (opcional)"
        rows={3}
        className="mb-2 w-full resize-none rounded border bg-background px-2 py-1 text-sm"
      />
      <select
        value={type}
        onChange={(e) => setType(e.target.value as NodeType)}
        className="mb-2 w-full rounded border bg-background px-2 py-1 text-sm"
      >
        {NODE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted">
          Cancelar
        </button>
        <button
          onClick={create}
          disabled={busy || !title.trim()}
          className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          Crear
        </button>
      </div>
    </div>
  )
}
