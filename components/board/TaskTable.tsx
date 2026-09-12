'use client'

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Search, Trash2 } from 'lucide-react'
import type { Node, NodePriority } from '@/lib/db/schema'
import { NODE_PRIORITIES } from '@/lib/db/schema'
import { useCanvasStore, selectNodes } from '@/store/canvas-store'
import { useBoardStore } from '@/store/board-store'
import { useWorkspaceMembers } from '@/hooks/useWorkspaceMembers'
import { mappedStatus } from '@/lib/canvas/board-columns'
import { patchNode, deleteNodeFromWorkspace } from '@/lib/canvas/node-mutations'
import { cn } from '@/lib/utils'
import { PriorityBadge } from './PriorityBadge'
import { EffortChip } from './EffortChip'
import { AssigneeAvatar } from './AssigneeAvatar'

// ============================================================
// Vista Tabla (F4): lectura + edición inline sobre el mismo
// canvas-store (los PATCH se reflejan por SSE, el demo muta local).
// Solo filasn `type === 'task'` — el alcance coincide con el tablero.
// ============================================================

type SortKey = 'title' | 'assignee' | 'priority' | 'effort' | 'column' | 'dueDate'
type SortState = { key: SortKey; dir: 'asc' | 'desc' }
type Filters = { search: string; assigneeId: string; priority: NodePriority | ''; columnId: string }

const PRIORITY_RANK: Record<NodePriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

export function TaskTable({ workspaceId }: { workspaceId: string }) {
  const nodes = useCanvasStore(selectNodes)
  const selectNode = useCanvasStore((s) => s.selectNode)
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId)
  const columns = useBoardStore((s) => s.columns)
  const { members, byId: memberById } = useWorkspaceMembers(workspaceId)

  const [sort, setSort] = useState<SortState>({ key: 'column', dir: 'asc' })
  const [filters, setFilters] = useState<Filters>({ search: '', assigneeId: '', priority: '', columnId: '' })

  const columnTitle = useMemo(
    () => new Map(columns.map((c) => [c.id, c.title])),
    [columns]
  )

  const rows = useMemo(() => {
    let list = nodes.filter((n) => n.type === 'task')

    // Filtros cliente (la query endpoint existe para consumo API; la UI
    // filtra en memoria sobre el store — SSE la mantiene fresca).
    if (filters.search.trim()) {
      const q = filters.search.trim().toLowerCase()
      list = list.filter(
        (n) => n.title.toLowerCase().includes(q) || (n.content ?? '').toLowerCase().includes(q)
      )
    }
    if (filters.assigneeId) list = list.filter((n) => n.assigneeId === filters.assigneeId)
    if (filters.priority) list = list.filter((n) => n.priority === filters.priority)
    if (filters.columnId) {
      // Mismo fallback que el tablero: una task sin boardColumnId vive (visible)
      // en la primera columna — el filtro la incluye cuando se filtra por ella.
      const firstColId = columns[0]?.id ?? null
      list = list.filter(
        (n) => (n.boardColumnId ?? firstColId) === filters.columnId
      )
    }

    const dir = sort.dir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      switch (sort.key) {
        case 'title':
          return a.title.localeCompare(b.title) * dir
        case 'assignee': {
          const an = (a.assigneeId && memberById.get(a.assigneeId)?.displayName) || ''
          const bn = (b.assigneeId && memberById.get(b.assigneeId)?.displayName) || ''
          return an.localeCompare(bn) * dir
        }
        case 'priority': {
          const av = a.priority ? PRIORITY_RANK[a.priority] : 99
          const bv = b.priority ? PRIORITY_RANK[b.priority] : 99
          return (av - bv) * dir
        }
        case 'effort': {
          const av = a.effort ?? -1
          const bv = b.effort ?? -1
          return (av - bv) * dir
        }
        case 'column': {
          const av = a.boardColumnId ? columnTitle.get(a.boardColumnId) ?? '' : ''
          const bv = b.boardColumnId ? columnTitle.get(b.boardColumnId) ?? '' : ''
          const base = av.localeCompare(bv) * dir
          return base !== 0 ? base : (a.boardOrder - b.boardOrder) * dir
        }
        case 'dueDate': {
          const av = a.dueDate ? a.dueDate.getTime() : Number.POSITIVE_INFINITY
          const bv = b.dueDate ? b.dueDate.getTime() : Number.POSITIVE_INFINITY
          return (av - bv) * dir
        }
      }
    })
  }, [nodes, filters, sort, memberById, columns, columnTitle])

  const toggleSort = (key: SortKey) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }

  const patch = (node: Node, updates: Record<string, unknown>) => patchNode(workspaceId, node, updates)

  const handleDelete = (node: Node) => {
    if (!window.confirm(`¿Eliminar la tarea “${node.title}”?`)) return
    deleteNodeFromWorkspace(workspaceId, node.id).catch((err) => {
      window.alert('No se pudo eliminar la tarea')
      console.error('[TaskTable] delete failed', err)
    })
  }

  const thCls =
    'sticky top-0 select-none border-b border-border bg-background px-3 py-2 text-left text-xs font-semibold text-muted-foreground'
  const thBtn = 'inline-flex items-center gap-1 hover:text-foreground'

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background px-4 py-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            placeholder="Buscar tarea…"
            className="h-9 rounded-lg border border-border bg-background pl-7 pr-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <select
          aria-label="Filtrar por responsable"
          value={filters.assigneeId}
          onChange={(e) => setFilters((f) => ({ ...f, assigneeId: e.target.value }))}
          className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
        >
          <option value="">Responsable: todos</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.displayName}
            </option>
          ))}
        </select>
        <select
          aria-label="Filtrar por prioridad"
          value={filters.priority}
          onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value as NodePriority | '' }))}
          className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
        >
          <option value="">Prioridad: todas</option>
          {NODE_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {capitalize(p)}
            </option>
          ))}
        </select>
        <select
          aria-label="Filtrar por columna"
          value={filters.columnId}
          onChange={(e) => setFilters((f) => ({ ...f, columnId: e.target.value }))}
          className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
        >
          <option value="">Columna: todas</option>
          {columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-muted-foreground">{rows.length} tarea(s)</span>
      </div>

      {/* Tabla */}
      <div className="flex-1 overflow-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr>
              <th className={cn(thCls)}>
                <button type="button" onClick={() => toggleSort('title')} className={thBtn}>
                  Título {sortIcon(sort, 'title')}
                </button>
              </th>
              <th className={cn(thCls)}>
                <button type="button" onClick={() => toggleSort('assignee')} className={thBtn}>
                  Responsable {sortIcon(sort, 'assignee')}
                </button>
              </th>
              <th className={cn(thCls)}>
                <button type="button" onClick={() => toggleSort('priority')} className={thBtn}>
                  Prioridad {sortIcon(sort, 'priority')}
                </button>
              </th>
              <th className={cn(thCls)}>
                <button type="button" onClick={() => toggleSort('effort')} className={thBtn}>
                  Esfuerzo {sortIcon(sort, 'effort')}
                </button>
              </th>
              <th className={cn(thCls)}>
                <button type="button" onClick={() => toggleSort('column')} className={thBtn}>
                  Columna {sortIcon(sort, 'column')}
                </button>
              </th>
              <th className={cn(thCls)}>
                <button type="button" onClick={() => toggleSort('dueDate')} className={thBtn}>
                  Vence {sortIcon(sort, 'dueDate')}
                </button>
              </th>
              <th className={cn(thCls, 'w-10')} aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {rows.map((node) => {
              const isDone = node.status === 'done'
              const due = node.dueDate ? new Date(node.dueDate) : null
              const overdue = !isDone && !!due && due.getTime() < Date.now()
              const assigneeName = node.assigneeId ? memberById.get(node.assigneeId)?.displayName ?? null : null
              return (
                <tr
                  key={node.id}
                  onClick={() => selectNode(node.id)}
                  className={cn(
                    'cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/40',
                    selectedNodeId === node.id && 'bg-accent/5'
                  )}
                >
                  <td className="px-3 py-2">
                    <span className={cn('font-medium', isDone && 'text-muted-foreground line-through')}>
                      {node.title}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      aria-label="Responsable"
                      value={node.assigneeId ?? ''}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => patch(node, { assigneeId: e.target.value || null })}
                      className="h-8 max-w-36 rounded border border-border bg-background px-1.5 text-xs"
                    >
                      <option value="">—</option>
                      {members.map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.displayName}
                        </option>
                      ))}
                    </select>
                    {assigneeName ? (
                      <span className="ml-2 inline-flex items-center gap-1 align-middle">
                        <AssigneeAvatar displayName={assigneeName} />
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      aria-label="Prioridad"
                      value={node.priority ?? ''}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => patch(node, { priority: e.target.value || null })}
                      className="h-8 rounded border border-border bg-background px-1.5 text-xs"
                    >
                      <option value="">—</option>
                      {NODE_PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                          {capitalize(p)}
                        </option>
                      ))}
                    </select>
                    <span className="ml-2 align-middle">
                      <PriorityBadge priority={node.priority} />
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      aria-label="Esfuerzo"
                      min={0}
                      max={100}
                      value={node.effort ?? ''}
                      placeholder="—"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const v = e.target.value === '' ? null : Math.max(0, Math.min(100, Math.round(Number(e.target.value))))
                        patch(node, { effort: v })
                      }}
                      className="h-8 w-16 rounded border border-border bg-background px-1.5 text-xs"
                    />
                    <span className="ml-2 align-middle">
                      <EffortChip effort={node.effort} />
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      aria-label="Columna"
                      value={node.boardColumnId ?? ''}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const colId = e.target.value
                        patch(node, { boardColumnId: colId, status: mappedStatus(colId, columns) })
                      }}
                      className="h-8 max-w-32 rounded border border-border bg-background px-1.5 text-xs"
                    >
                      {columns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {due ? (
                      <span className={cn('text-xs', overdue ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                        {due.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      aria-label={`Eliminar ${node.title}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(node)
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No hay tareas que coincidan con los filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function sortIcon(sort: SortState, key: SortKey) {
  if (sort.key !== key) return <ArrowUpDown className="h-3 w-3 opacity-50" />
  return sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}