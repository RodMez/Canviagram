'use client'

import { cn } from '@/lib/utils'
import type { Node } from '@/lib/db/schema'
import { DEMO_ASSIGNEES, getDemoBuckets, type DemoBucket } from '@/lib/demo/fixtures'
import { blockersOf } from '@/components/board/Board'
import { useCanvasStore, selectNodes, selectEdges } from '@/store/canvas-store'
import { AssigneeAvatar } from '@/components/board/AssigneeAvatar'
import { PriorityBadge } from '@/components/board/PriorityBadge'
import { CalendarClock, Lock } from 'lucide-react'

const BUCKETS: { id: DemoBucket; title: string; hint: string }[] = [
  { id: 'overdue', title: 'Vencidas', hint: 'Primero esto' },
  { id: 'today', title: 'Hoy', hint: 'El corazón del día' },
  { id: 'upcoming', title: 'Próximas', hint: 'En el radar' },
  { id: 'done', title: 'Hechas', hint: 'Ya salió' },
]

function dueLabel(due: Date | null, now: Date): string {
  if (!due) return 'Sin fecha'
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const day = 24 * 60 * 60 * 1000
  const diff = Math.floor((due.getTime() - start.getTime()) / day)
  if (diff < 0) return due.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
  if (diff === 0) {
    return `Hoy ${due.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
  }
  if (diff === 1) return 'Mañana'
  return due.toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: 'short' })
}

// ============================================================
// Preview de la vista Hoy para la demo pública (F7).
// Solo lectura: agrupa las tareas del store con getDemoBuckets
// (misma regla que today-client, sin fetch ni API). Clic en una
// tarea la selecciona (abre su detalle en el panel derecho).
// ============================================================
export function DemoTodayPreview() {
  const nodes = useCanvasStore(selectNodes)
  const edges = useCanvasStore(selectEdges)
  const selectNode = useCanvasStore((s) => s.selectNode)
  const now = new Date()
  const buckets = getDemoBuckets(nodes, now)

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-b from-secondary/60 via-background to-background p-3 sm:p-4">
      <div className="mx-auto w-full max-w-xl space-y-3 pb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Hoy en Café Luna
        </p>
        {BUCKETS.map((bucket) => {
          const list: Node[] = buckets[bucket.id]
          if (list.length === 0) return null
          return (
            <section
              key={bucket.id}
              className={cn(
                'rounded-2xl border bg-card p-3 shadow-sm',
                bucket.id === 'overdue' && 'border-destructive/40',
                bucket.id === 'today' && 'border-primary/40'
              )}
            >
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold">{bucket.title}</h3>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">
                  {list.length}
                </span>
                <span className="text-xs text-muted-foreground">{bucket.hint}</span>
              </div>
              <ul className="mt-2 space-y-2">
                {list.map((task) => {
                  const assignee = DEMO_ASSIGNEES[task.id] ?? null
                  const due = task.dueDate ? new Date(task.dueDate) : null
                  const blocked = blockersOf(edges, nodes, task)
                  const isDone = task.status === 'done'
                  return (
                    <li key={task.id}>
                      <button
                        type="button"
                        onClick={() => selectNode(task.id)}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border/60 bg-background px-3 py-2.5 text-left shadow-sm transition-all hover:shadow motion-safe:hover:scale-[1.01]"
                      >
                        <AssigneeAvatar displayName={assignee} />
                        <span className="min-w-0 flex-1">
                          <span className={cn('block truncate text-sm font-semibold', isDone && 'text-muted-foreground line-through')}>
                            {task.title}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <CalendarClock className="h-3 w-3" />
                              {dueLabel(due, now)}
                            </span>
                            {blocked.length > 0 && (
                              <span className="flex items-center gap-1 font-medium text-destructive">
                                <Lock className="h-3 w-3" />
                                Bloqueada
                              </span>
                            )}
                          </span>
                        </span>
                        <PriorityBadge priority={task.priority} />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}
