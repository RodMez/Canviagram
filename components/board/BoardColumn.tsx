'use client'

import { useEffect, useRef, useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import type { BoardColumn as BoardColumnType, Node } from '@/lib/db/schema'
import { cn } from '@/lib/utils'
import { BoardCard } from './BoardCard'

type BoardColumnProps = {
  column: BoardColumnType
  /** Lista ordenada de TODAS las columnas del workspace (para "Mover a"). */
  allColumns: BoardColumnType[]
  nodes: Node[]
  draggingId: string | null
  blockedBy: (node: Node) => Node[]
  /** displayName por userId (lookup de workspaces members). */
  memberName: (userId: string) => string | null
  onAddTask: (column: BoardColumnType, screenPos: { x: number; y: number }) => void
  onMoveCard: (nodeId: string, columnId: string) => void
  onDeleteCard: (node: Node) => void
  onRenameColumn: (column: BoardColumnType, title: string) => void
  onDeleteColumn: (column: BoardColumnType) => void
}

// Columna editable del tablero (F3): título editable en línea (doble-clic),
// menú Renombrar/Eliminar, zona droppable por columnId y sortable por boardOrder.
export function BoardColumn({
  column,
  allColumns,
  nodes,
  draggingId,
  blockedBy,
  memberName,
  onAddTask,
  onMoveCard,
  onDeleteCard,
  onRenameColumn,
  onDeleteColumn,
}: BoardColumnProps) {
  const { isOver, setNodeRef } = useDroppable({ id: `col:${column.id}` })
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(column.title)
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as HTMLElement)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const commitRename = () => {
    const next = draft.trim()
    setEditing(false)
    if (next && next !== column.title) onRenameColumn(column, next)
    setDraft(column.title)
  }



  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex w-72 shrink-0 flex-col rounded-xl border border-border bg-muted/40',
        isOver && 'ring-2 ring-ring ring-offset-1'
      )}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full bg-primary/70" aria-hidden />
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') {
                  setDraft(column.title)
                  setEditing(false)
                }
              }}
              className="w-32 rounded border border-border bg-background px-1.5 py-0.5 text-sm font-semibold outline-none focus:ring-1 focus:ring-ring"
            />
          ) : (
            <button
              type="button"
              onDoubleClick={() => {
                setDraft(column.title)
                setEditing(true)
              }}
              title="Doble-clic para renombrar"
              className="truncate text-sm font-semibold"
            >
              {column.title}
            </button>
          )}
          <span className="rounded-full bg-background px-1.5 py-0.5 text-xs text-muted-foreground">
            {nodes.length}
          </span>
        </div>
        <div className="flex shrink-0 items-center">
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              aria-label={`Acciones de la columna ${column.title}`}
              onClick={() => setMenuOpen((o) => !o)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-lg border bg-popover p-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    setDraft(column.title)
                    setEditing(true)
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                >
                  <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                  Renombrar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    onDeleteColumn(column)
                  }}
                  disabled={allColumns.length <= 1}
                  title={allColumns.length <= 1 ? 'No se puede eliminar la última columna' : undefined}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Eliminar columna
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={(e) => onAddTask(column, { x: e.clientX, y: e.clientY })}
            aria-label={`Crear tarea en ${column.title}`}
            title={`Crear tarea en ${column.title}`}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted/80"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      <SortableContext items={nodes.map((n) => n.id)} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto p-2">
          {nodes.map((node) => (
            <BoardCard
              key={node.id}
              node={node}
              blockedBy={blockedBy(node)}
              dragging={draggingId === node.id}
              columns={allColumns}
              assigneeName={node.assigneeId ? memberName(node.assigneeId) : null}
              onMoveTo={(colId) => onMoveCard(node.id, colId)}
              onDelete={() => onDeleteCard(node)}
            />
          ))}
          {nodes.length === 0 && (
            <p className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
              Sin tareas
            </p>
          )}
        </div>
      </SortableContext>
      {/* status mapeado (invisible) para tests/aserciones de coherencia */}
    </div>
  )
}