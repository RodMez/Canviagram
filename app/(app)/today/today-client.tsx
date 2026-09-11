'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CalendarDays, Check, FolderKanban, RefreshCw } from 'lucide-react'
import type { TodayBucket, TodayItem } from '@/lib/today-service'

// La API serializa Date → string ISO en JSON.
type TodayClientItem = Omit<TodayItem, 'dueDate'> & { dueDate: string | null }

// ============================================================
// Vista Hoy / Enfoque (F5.4): lo accionable de todos los
// workspaces en una sola pantalla. Sin tiempo real en v1:
// fetch al montar + botón refrescar + refetch en window focus.
// ============================================================

const BUCKETS: Array<{ id: TodayBucket; title: string; hint: string; collapsedByDefault: boolean }> = [
  { id: 'overdue', title: 'Vencidas', hint: 'Pasaron su fecha', collapsedByDefault: false },
  { id: 'today', title: 'Hoy', hint: 'Vencen hoy', collapsedByDefault: false },
  { id: 'upcoming', title: 'Próximas', hint: 'Fechas futuras', collapsedByDefault: false },
  { id: 'in_progress', title: 'En progreso', hint: 'Sin fecha', collapsedByDefault: false },
  { id: 'backlog', title: 'Pendientes', hint: 'Sin fecha', collapsedByDefault: true },
]

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

export function TodayClient({ userName, userEmail }: { userName: string | null; userEmail: string | null }) {
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

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4">
        <Link href="/today" className="flex items-center gap-2 text-sm font-semibold">
          <CalendarDays className="h-5 w-5 text-primary" />
          <span>Hoy</span>
        </Link>
        <Link href="/workspaces" className="flex items-center gap-1.5 rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted">
          <FolderKanban className="h-4 w-4" />
          <span>Workspaces</span>
        </Link>
        <div className="flex-1" />
        <button
          onClick={load}
          disabled={refreshing}
          aria-label="Refrescar"
          title="Refrescar"
          className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
        <div className="flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-sm">
          <span className="font-medium">{userName ?? 'Usuario'}</span>
          {userEmail ? <span className="text-xs text-muted-foreground">{userEmail}</span> : null}
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Hoy</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {items === null ? 'Cargando...' : total === 0 ? 'Nada pendiente. Buen momento para planear.' : `${total} pendiente${total === 1 ? '' : 's'} en tus workspaces`}
        </p>
        {loadError ? (
          <p role="alert" className="mt-2 text-xs text-red-600">
            {loadError}
          </p>
        ) : null}

        {items !== null && total === 0 && !loadError ? (
          <div className="mt-6 rounded-lg border bg-card p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Sin tareas ni fechas. Crea tu primera tarea desde un workspace.
            </p>
            <Link
              href="/workspaces"
              className="mt-3 inline-block rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Ir a workspaces
            </Link>
          </div>
        ) : null}

        <div className="mt-6 space-y-6">
          {BUCKETS.map((bucket) => {
            const list = byBucket.get(bucket.id) ?? []
            if (list.length === 0) return null
            const isCollapsed = collapsed[bucket.id]
            return (
              <section key={bucket.id}>
                <button
                  onClick={() => setCollapsed((c) => ({ ...c, [bucket.id]: !c[bucket.id] }))}
                  aria-expanded={!isCollapsed}
                  className="flex w-full items-baseline gap-2 text-left"
                >
                  <h2 className="text-sm font-semibold">
                    {bucket.title} <span className="font-normal text-muted-foreground">· {list.length}</span>
                  </h2>
                  <span className="text-xs text-muted-foreground">{bucket.hint}</span>
                </button>
                {!isCollapsed ? (
                  <ul className="mt-2 space-y-2">
                    {list.map((item) => (
                      <li
                        key={item.nodeId}
                        className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3"
                      >
                        {item.status === 'todo' || item.status === 'in_progress' ? (
                          <button
                            onClick={() => markDone(item)}
                            disabled={doneBusy === item.nodeId}
                            aria-label={`Marcar "${item.title}" como hecha`}
                            title="Marcar hecha"
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-transparent hover:border-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{item.title}</p>
                          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Link href={`/w/${item.workspaceSlug}`} className="hover:underline">
                              {item.workspaceName}
                            </Link>
                            <span>·</span>
                            <span>{item.type}</span>
                            {item.status === 'in_progress' ? (
                              <>
                                <span>·</span>
                                <span>en progreso</span>
                              </>
                            ) : null}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">
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
