'use client'

import { useEffect, useState } from 'react'
import { useCanvasStore, selectSelectedNode } from '@/store/canvas-store'
import { useBoardStore } from '@/store/board-store'
import { useDebouncedSave, createNodeSaveFn } from '@/hooks/useDebouncedSave'
import { useWorkspaceMembers } from '@/hooks/useWorkspaceMembers'
import { columnForStatus, mappedStatus } from '@/lib/canvas/board-columns'
import {
  NODE_TYPES,
  NODE_STATUSES,
  NODE_PRIORITIES,
  RECURRENCE_RULES,
  type NodeType,
  type NodeStatus,
  type NodePriority,
  type RecurrenceRule,
} from '@/lib/db/schema'
import { isDemoWorkspace } from '@/lib/demo/fixtures'

type NodeDetailPanelProps = { workspaceId: string; userId: string }

// Convierte dueDate (Date real, string ISO por JSON, epoch ms o null) a epoch ms.
// Nunca lanza: string inválido / tipo inesperado -> null.
// Cubre fetch inicial, eventos SSE y fixtures demo (el type Drizzle dice Date|null
// pero por NextResponse.json / SSE llega string ISO al cliente).
export function getDueDateMs(value: unknown): number | null {
  if (value == null) return null
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isNaN(ms) ? null : ms
  }
  if (typeof value === 'number') {
    return Number.isNaN(value) ? null : value
  }
  if (typeof value === 'string') {
    if (value.trim() === '') return null
    const ms = new Date(value).getTime()
    return Number.isNaN(ms) ? null : ms
  }
  return null
}

// Panel de detalle del nodo (Diseño 12.3): formulario con autosave debounced 500ms.
// Modo demo (F4.1): save/delete locales vía applyLocalEvent (cero fetch).
export function NodeDetailPanel({ workspaceId, userId }: NodeDetailPanelProps) {
  const node = useCanvasStore(selectSelectedNode)
  const selectNode = useCanvasStore((s) => s.selectNode)
  const applyLocalEvent = useCanvasStore((s) => s.applyLocalEvent)
  const boardColumns = useBoardStore((s) => s.columns)
  const { members } = useWorkspaceMembers(workspaceId)
  const isDemo = isDemoWorkspace(workspaceId)
  const [title, setTitle] = useState(node?.title ?? '')
  const [type, setType] = useState<NodeType>(node?.type ?? 'task')
  const [content, setContent] = useState(node?.content ?? '')
  const [status, setStatus] = useState<NodeStatus>(node?.status ?? 'todo')
  const [priority, setPriority] = useState<NodePriority | null>(node?.priority ?? null)
  const [effort, setEffort] = useState<string>(node?.effort == null ? '' : String(node?.effort))
  const [assigneeId, setAssigneeId] = useState<string | null>(node?.assigneeId ?? null)
  const [boardColumnId, setBoardColumnId] = useState<string | null>(node?.boardColumnId ?? null)
  const [dueDate, setDueDate] = useState<number | null>(getDueDateMs(node?.dueDate))
  const [reminderOffsetMin, setReminderOffsetMin] = useState<number | null>(node?.reminderOffsetMin ?? null)
  const [recurrenceRule, setRecurrenceRule] = useState<RecurrenceRule | null>(node?.recurrenceRule ?? null)

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
    setPriority(node?.priority ?? null)
    setEffort(node?.effort == null ? '' : String(node?.effort))
    setAssigneeId(node?.assigneeId ?? null)
    setBoardColumnId(node?.boardColumnId ?? null)
    setDueDate(getDueDateMs(node?.dueDate))
    setReminderOffsetMin(node?.reminderOffsetMin ?? null)
    setRecurrenceRule(node?.recurrenceRule ?? null)
  }, [node?.id])
  /* eslint-enable react-hooks/exhaustive-deps */

  if (!node) return null

  const isTask = type === 'task'

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

  const fieldCls = 'mt-1 w-full min-h-11 rounded-lg border border-border bg-background px-3 py-2 text-base outline-none focus:ring-2 focus:ring-ring sm:text-sm'

  function toLocalInputValue(ts: number | null): string {
    if (ts == null) return ''
    const d = new Date(ts)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const REMINDER_OPTIONS: Array<{ value: number | null; label: string }> = [
    { value: null, label: 'Con la fecha' },
    { value: 0, label: 'Al momento' },
    { value: 15, label: '15 min antes' },
    { value: 60, label: '1 h antes' },
    { value: 1440, label: '1 día antes' },
    { value: 10080, label: '1 semana antes' },
  ]

  const RECURRENCE_OPTIONS: Array<{ value: RecurrenceRule | null; label: string }> = [
    { value: null, label: 'No se repite' },
    { value: 'daily', label: 'Cada día' },
    { value: 'weekly', label: 'Cada semana' },
    { value: 'monthly', label: 'Cada mes' },
  ]

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
              // Cambio a no-task realoja TODOS los campos task-only (el server
              // rechaza si quedan): status + prioridad + esfuerzo + responsable
              // + columna.
              if (nextType !== 'task') {
                setStatus('todo')
                setPriority(null)
                setEffort('')
                setAssigneeId(null)
                setBoardColumnId(null)
                save.trigger({
                  type: nextType,
                  status: null,
                  priority: null,
                  effort: null,
                  assigneeId: null,
                  boardColumnId: null,
                })
              } else {
                save.trigger({ type: nextType })
              }
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

        {isTask && (
          <>
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Columna del tablero</span>
              <select
                value={boardColumnId ?? ''}
                onChange={(e) => {
                  const colId = e.target.value
                  setBoardColumnId(colId)
                  // Coherencia: la columna determina el status visible.
                  // Mismo mapeo que el servidor aplica en POST /board/move.
                  const next = mappedStatus(colId, boardColumns)
                  setStatus(next)
                  save.trigger({ boardColumnId: colId, status: next })
                }}
                onBlur={() => save.flush()}
                className={fieldCls}
              >
                {boardColumns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Estado</span>
              <select
                value={status}
                onChange={(e) => {
                  const next = e.target.value as NodeStatus
                  setStatus(next)
                  // Sincroniza con el tablero: status → primera columna que lo
                  // mapea. Si el usuario elige column ≠ status, manda la columna.
                  const col = boardColumns.length > 0 ? columnForStatus(boardColumns, next) : undefined
                  if (col) {
                    setBoardColumnId(col.id)
                    save.trigger({ status: next, boardColumnId: col.id })
                  } else {
                    save.trigger({ status: next })
                  }
                }}
                onBlur={() => save.flush()}
                className={fieldCls}
              >
                {NODE_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Prioridad</span>
                <select
                  value={priority ?? ''}
                  onChange={(e) => {
                    const next = (e.target.value || null) as NodePriority | null
                    setPriority(next)
                    save.trigger({ priority: next })
                  }}
                  onBlur={() => save.flush()}
                  className={fieldCls}
                >
                  <option value="">—</option>
                  {NODE_PRIORITIES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Esfuerzo (0–100)</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={effort}
                  onChange={(e) => {
                    const raw = e.target.value
                    setEffort(raw)
                    if (raw === '') {
                      save.trigger({ effort: null })
                      return
                    }
                    const n = Math.round(Number(raw))
                    if (Number.isFinite(n)) save.trigger({ effort: Math.max(0, Math.min(100, n)) })
                  }}
                  onBlur={() => save.flush()}
                  className={fieldCls}
                />
              </label>
            </div>

            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Responsable</span>
              <select
                value={assigneeId ?? ''}
                onChange={(e) => {
                  const next = e.target.value || null
                  setAssigneeId(next)
                  save.trigger({ assigneeId: next })
                }}
                onBlur={() => save.flush()}
                className={fieldCls}
              >
                <option value="">Sin asignar</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Fecha límite</span>
          <input
            type="datetime-local"
            value={toLocalInputValue(dueDate)}
            onChange={(e) => {
              const v = e.target.value
              const next = v ? new Date(v).getTime() : null
              setDueDate(next)
              // Sin fecha no hay recurrencia (el servidor también la limpia).
              if (next == null && recurrenceRule != null) {
                setRecurrenceRule(null)
                save.trigger({ dueDate: next, recurrenceRule: null })
              } else {
                save.trigger({ dueDate: next })
              }
            }}
            onBlur={() => save.flush()}
            className={fieldCls}
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Recordatorio</span>
          <select
            value={reminderOffsetMin ?? ''}
            onChange={(e) => {
              const raw = e.target.value
              const next = raw === '' ? null : Number(raw)
              setReminderOffsetMin(next)
              save.trigger({ reminderOffsetMin: next })
            }}
            onBlur={() => save.flush()}
            className={fieldCls}
          >
            {REMINDER_OPTIONS.map((o) => (
              <option key={o.value ?? 'none'} value={o.value ?? ''}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Repetir</span>
          <select
            value={recurrenceRule ?? ''}
            disabled={dueDate == null}
            title={dueDate == null ? 'Fija una fecha límite para activar la repetición' : undefined}
            onChange={(e) => {
              const raw = e.target.value
              const next = (raw === '' ? null : raw) as RecurrenceRule | null
              setRecurrenceRule(next)
              save.trigger({ recurrenceRule: next })
            }}
            onBlur={() => save.flush()}
            className={fieldCls}
          >
            {RECURRENCE_OPTIONS.map((o) => (
              <option key={o.value ?? 'none'} value={o.value ?? ''}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center">
          {save.status === 'saved' && <span className="text-xs text-emerald-600">Guardado</span>}
          {save.status === 'saving' && <span className="text-xs text-muted-foreground">Guardando…</span>}
          <button
            onClick={handleDelete}
            className="ml-auto h-10 rounded-lg bg-destructive px-4 text-xs font-medium text-destructive-foreground active:opacity-80"
          >
            Eliminar
          </button>
        </div>
      </div>
    </div>
  )
}