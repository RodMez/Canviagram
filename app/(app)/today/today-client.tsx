'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, Flame, RefreshCw } from 'lucide-react'
import type { TodayBucket, TodayItem } from '@/lib/today-service'
import { useSetHeaderActions } from '@/components/layout/header-actions-context'

// ============================================================
// Vista Hoy / Enfoque (F5.4, visual Fase V — energía alta)
//
// Pantalla emblema: bento por urgencia con color propio, número
// gigante del día y marcar-hecha de 44px. Sin tiempo real en v1:
// fetch al montar + botón refrescar + refetch en window focus.
// ============================================================

type BucketMeta = {
  id: TodayBucket
  title: string
  hint: string
  collapsedByDefault: boolean
  /** Acento de la tarjeta bento (clases completas para el JIT). */
  card: string
  chip: string
  dot: string
}

const BUCKETS: BucketMeta[] = [
  {
    id: 'overdue',
    title: 'Vencidas',
    hint: 'Primero esto',
    collapsedByDefault: false,
    card: 'border-destructive/40 bg-destructive/[0.04]',
    chip: 'bg-destructive text-destructive-foreground',
    dot: 'bg-destructive',
  },
  {
    id: 'today',
    title: 'Hoy',
    hint: 'El corazón del día',
    collapsedByDefault: false,
    card: 'border-primary/40 bg-primary/[0.04]',
    chip: 'bg-primary text-primary-foreground',
    dot: 'bg-primary',
  },
  {
    id: 'upcoming',
    title: 'Próximas',
    hint: 'En el radar',
    collapsedByDefault: false,
    card: 'border-accent/40 bg-accent/[0.05]',
    chip: 'bg-accent text-accent-foreground',
    dot: 'bg-accent',
  },
  {
    id: 'in_progress',
    title: 'En progreso',
    hint: 'Sin fecha, en marcha',
    collapsedByDefault: false,
    card: 'border-amber-600/40 bg-amber-500/[0.06]',
    chip: 'bg-amber-700 text-white',
    dot: 'bg-amber-500',
  },
  {
    id: 'backlog',
    title: 'Pendientes',
    hint: 'Sin fecha',
    collapsedByDefault: true,
    card: 'border-border bg-card',
    chip: 'bg-muted text-muted-foreground',
    dot: 'bg-muted-foreground/40',
  },
]

// La API serializa Date → string ISO en JSON.
type TodayClientItem = Omit<TodayItem, 'dueDate'> & { dueDate: string | null }

function formatDue(dueDate: string | null): string {
  if (!dueDate) return 'Sin fecha'
  return new Date(dueDate).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    ...(new Date(dueDate).getFullYear() !== new Date().getFullYear()
      ? { year: 'numeric' as const }
      : {}),
  })
}

function todayLabel(): string {
  const now = new Date()
  const s = now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function TodayClient() {
  const router = useRouter()
  const [items, setItems] = useState<TodayClientItem[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [doneBusy, setDoneBusy] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Record<TodayBucket, boolean>>({
    overdue: false,
    today: false,
    upcoming: false,
    in_progress: false,
    backlog: true,
  })

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/today')
      if (res.status === 401) {
        router.push('/login?next=/today')
        return
      }
      if (!res.ok) throw new Error('failed')
      const data = (await res.json()) as { items: TodayClientItem[] }
      setItems(data.items ?? [])
      setLoadError(null)
    } catch {
      setLoadError('No se pudo cargar tu día')
    } finally {
      setRefreshing(false)
    }
  }, [router])

  useEffect(() => {
    load()
  }, [load])

  // Refetch al volver a la pestaña (sin SSE cross-workspace en v1).
  useEffect(() => {
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  // Acción contextual en el header global (el header vive en AppShell).
  // Memoizada: el slot re-publica en cada cambio de identidad y sin esto
  // entraría en bucle render → efecto → setState.
  const headerActions = useMemo(
    () => (
      <button
        onClick={load}
        disabled={refreshing}
        aria-label="Refrescar"
        title="Refrescar"
        className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-all hover:bg-muted disabled:opacity-50"
      >
        <RefreshCw className={`h-4 w-4 ${refreshing ? 'motion-safe:animate-spin' : ''}`} />
      </button>
    ),
    [load, refreshing]
  )
  useSetHeaderActions(headerActions)

  async function markDone(item: TodayClientItem) {
    if (doneBusy) return
    setDoneBusy(item.nodeId)
    try {
      const res = await fetch(`/api/workspaces/${item.workspaceId}/nodes/${item.nodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      })
      if (!res.ok) throw new Error('failed')
      await load()
    } catch {
      setLoadError('No se pudo marcar como hecha')
    } finally {
      setDoneBusy(null)
    }
  }

  const byBucket = new Map<TodayBucket, TodayClientItem[]>()
  for (const item of items ?? []) {
    const list = byBucket.get(item.bucket) ?? []
    list.push(item)
    byBucket.set(item.bucket, list)
  }
  const total = items?.length ?? 0
  const urgent = (byBucket.get('overdue')?.length ?? 0) + (byBucket.get('today')?.length ?? 0)

  return (
    <div className="flex-1 overflow-y-auto bg-gradient-to-b from-secondary via-background to-background">
      <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
        {/* Hero del día */}
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">{todayLabel()}</p>
            <h1 className="mt-1 font-display text-5xl font-semibold leading-none tracking-tight sm:text-6xl">
              {items === null ? '…' : total === 0 ? 'Día libre' : `${urgent}`}
              <span className="ml-2 align-middle font-sans text-lg font-medium text-muted-foreground">
                {items === null ? '' : total === 0 ? 'nada pendiente' : urgent === 1 ? 'cosa hoy' : 'cosas hoy'}
              </span>
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {items === null
                ? 'Cargando tu día...'
                : total === 0
                  ? 'Buen momento para planear lo siguiente.'
                  : `${total} pendiente${total === 1 ? '' : 's'} en tus workspaces`}
            </p>
          </div>
          {urgent > 0 ? (
            <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm">
              <Flame className="h-3.5 w-3.5" />
              Enfócate
            </span>
          ) : null}
        </div>

        {loadError ? (
          <p role="alert" className="mt-3 text-xs text-red-600">
            {loadError}
          </p>
        ) : null}

        {items !== null && total === 0 && !loadError ? (
          <div className="mt-6 rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
            <p className="font-display text-2xl font-semibold">Todo despejado</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Sin tareas ni fechas. Crea tu primera tarea desde un workspace.
            </p>
            <Link
              href="/workspaces"
              className="mt-4 inline-block cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:opacity-90"
            >
              Ir a workspaces
            </Link>
          </div>
        ) : null}

        <div className="mt-6 space-y-4">
          {BUCKETS.map((bucket) => {
            const list = byBucket.get(bucket.id) ?? []
            if (list.length === 0) return null
            const isCollapsed = collapsed[bucket.id]
            return (
              <section key={bucket.id} className={`rounded-2xl border p-4 shadow-sm transition-all ${bucket.card}`}>
                <button
                  onClick={() => setCollapsed((c) => ({ ...c, [bucket.id]: !c[bucket.id] }))}
                  aria-expanded={!isCollapsed}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${bucket.dot}`} aria-hidden />
                  <h2 className="font-display text-xl font-semibold tracking-wide">{bucket.title}</h2>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${bucket.chip}`}>{list.length}</span>
                  <span className="text-xs text-muted-foreground">{bucket.hint}</span>
                </button>
                {!isCollapsed ? (
                  <ul className="mt-3 space-y-2">
                    {list.map((item) => (
                      <li
                        key={item.nodeId}
                        className="flex items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-2.5 shadow-sm transition-all motion-safe:hover:scale-[1.01] hover:shadow"
                      >
                        {item.status === 'todo' || item.status === 'in_progress' ? (
                          <button
                            onClick={() => markDone(item)}
                            disabled={doneBusy === item.nodeId}
                            aria-label={`Marcar "${item.title}" como hecha`}
                            title="Marcar hecha"
                            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 border-primary/50 text-transparent transition-all hover:border-primary hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                          >
                            <Check className="h-5 w-5" strokeWidth={3} />
                          </button>
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{item.title}</p>
                          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Link href={`/w/${item.workspaceSlug}`} className="cursor-pointer font-medium hover:underline">
                              {item.workspaceName}
                            </Link>
                            <span aria-hidden>·</span>
                            <span className="rounded bg-muted px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide">
                              {item.type}
                            </span>
                            {item.status === 'in_progress' ? (
                              <>
                                <span aria-hidden>·</span>
                                <span className="font-medium text-amber-700">en progreso</span>
                              </>
                            ) : null}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground">
                          {formatDue(item.dueDate)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            )
          })}
        </div>
      </main>
    </div>
  )
}
