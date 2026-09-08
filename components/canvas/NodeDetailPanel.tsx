'use client'

import { useEffect, useState } from 'react'
import { useCanvasStore, selectSelectedNode } from '@/store/canvas-store'
import { useDebouncedSave, createNodeSaveFn } from '@/hooks/useDebouncedSave'
import { NODE_TYPES, NODE_STATUSES, type NodeType, type NodeStatus } from '@/lib/db/schema'
import { isDemoWorkspace } from '@/lib/demo/fixtures'

type NodeDetailPanelProps = { workspaceId: string; userId: string }

// Panel de detalle del nodo (Diseño 12.3): formulario con autosave debounced 500ms.
// Modo demo (F4.1): save/delete locales vía applyLocalEvent (cero fetch).
export function NodeDetailPanel({ workspaceId, userId }: NodeDetailPanelProps) {
  const node = useCanvasStore(selectSelectedNode)
  const selectNode = useCanvasStore((s) => s.selectNode)
  const applyLocalEvent = useCanvasStore((s) => s.applyLocalEvent)
  const isDemo = isDemoWorkspace(workspaceId)
  const [title, setTitle] = useState(node?.title ?? '')
  const [type, setType] = useState<NodeType>(node?.type ?? 'task')
  const [content, setContent] = useState(node?.content ?? '')
  const [status, setStatus] = useState<NodeStatus>(node?.status ?? 'todo')

  const save = useDebouncedSave({
    fn: isDemo
      ? async (updates: Record<string, unknown>) => {
          // El reducer mergea { ...n, ...data }: el objeto mergeado es el nodo actual + updates.
          applyLocalEvent({ event: 'node:updated', data: { ...node, ...updates } })
        }
      : createNodeSaveFn(workspaceId, node?.id ?? '', userId),
    delay: 500,
  })
  const { flush } = save

  // Flush pendientes al desmontar o al cambiar de nodo (el hook no flushea en unmount).
  useEffect(() => () => flush(), [flush])

  // Re-sincroniza solo al cambiar de nodo (un SSE node:updated no debe pisar la edición).
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    setTitle(node?.title ?? '')
    setType(node?.type ?? 'task')
    setContent(node?.content ?? '')
    setStatus(node?.status ?? 'todo')
  }, [node?.id])
  /* eslint-enable react-hooks/exhaustive-deps */

  if (!node) return null

  const handleDelete = async () => {
    try {
      // Demo (F4.1): borrado local; el reducer cascadea los edges.
      if (isDemo) {
        applyLocalEvent({ event: 'node:deleted', data: { id: node.id, workspaceId: 'demo' } })
        selectNode(null)
        return
      }
      const res = await fetch(`/api/workspaces/${workspaceId}/nodes/${node.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Error al eliminar')
      selectNode(null) // SSE node:deleted también deselecciona; esto es inmediato.
    } catch (err) {
      console.error('[NodeDetailPanel] delete failed', err)
    }
  }

  const fieldCls = 'mt-1 w-full rounded border bg-background px-3 py-2 text-sm'

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Detalle del nodo</h2>
        <button onClick={() => selectNode(null)} className="text-xs text-muted-foreground hover:text-foreground">
          Cerrar
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Título</span>
          <input
            value={title}
            onChange={(e) => { setTitle(e.target.value); save.trigger({ title: e.target.value }) }}
            onBlur={() => save.flush()}
            className={fieldCls}
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Tipo</span>
          <select
            value={type}
            onChange={(e) => {
              const nextType = e.target.value as NodeType
              setType(nextType)
              // Cambio a no-task realoja status (solo task puede tener status).
              save.trigger(nextType !== 'task' ? { type: nextType, status: null } : { type: nextType })
            }}
            onBlur={() => save.flush()}
            className={fieldCls}
          >
            {NODE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Descripción</span>
          <textarea
            value={content}
            onChange={(e) => { setContent(e.target.value); save.trigger({ content: e.target.value }) }}
            onBlur={() => save.flush()}
            rows={5}
            className={fieldCls}
          />
        </label>

        {type === 'task' && (
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Estado</span>
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value as NodeStatus); save.trigger({ status: e.target.value as NodeStatus }) }}
              onBlur={() => save.flush()}
              className={fieldCls}
            >
              {NODE_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          </label>
        )}

        <div className="flex items-center">
          {save.status === 'saved' && <span className="text-xs text-emerald-600">Guardado</span>}
          {save.status === 'saving' && <span className="text-xs text-muted-foreground">Guardando…</span>}
          <button
            onClick={handleDelete}
            className="ml-auto rounded bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground"
          >
            Eliminar
          </button>
        </div>
      </div>
    </div>
  )
}
