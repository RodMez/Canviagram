'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

type TelegramLink = {
  code: string
  expiresAt: string
  ttlSeconds: number
  workspaceId: string | null
}

type TelegramChat = {
  chatId: string
  tgUserId: string
  activeWorkspaceId: string | null
  lastActivityAt: string | null
}

type TelegramWorkspace = {
  id: string
  name: string
  slug: string
}

type TelegramStatus = {
  enabled: boolean
  botUsername: string | null
  webhook: {
    ok: boolean
    url: string
    pendingUpdateCount: number
    lastError: string | null
    lastErrorDate: string | null
  } | null
  chats: TelegramChat[]
  workspaces: TelegramWorkspace[]
}

type Feedback = { kind: 'error' | 'ok' | 'neutral'; text: string }

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function TelegramAccountClient() {
  const router = useRouter()
  const [link, setLink] = useState<TelegramLink | null>(null)
  const [msg, setMsg] = useState<Feedback | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<TelegramStatus | null>(null)
  const [initialWs, setInitialWs] = useState<string>('')

  const apiFetch = useCallback(
    async (url: string, init?: RequestInit) => {
      const res = await fetch(url, init)
      if (res.status === 401) {
        router.push('/login')
        throw new Error('No autorizado')
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      return { res, data }
    },
    [router]
  )

  const loadStatus = useCallback(async () => {
    try {
      const { res, data } = await apiFetch('/api/telegram/status')
      if (res.ok) setStatus(data as unknown as TelegramStatus)
    } catch {
      // silencioso: se reintenta al recargar
    }
  }, [apiFetch])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  async function generateCode() {
    setBusy(true)
    setMsg(null)
    try {
      const { res, data } = await apiFetch('/api/telegram/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(initialWs ? { workspaceId: initialWs } : {}),
      })
      if (res.ok) {
        setLink(data as unknown as TelegramLink)
      } else if (res.status === 503) {
        setMsg({ kind: 'neutral', text: 'Telegram no está habilitado en este despliegue' })
      } else {
        setMsg({ kind: 'neutral', text: data.error ?? 'Error al generar el código' })
      }
    } catch {
      setMsg({ kind: 'neutral', text: 'Error de red' })
    } finally {
      setBusy(false)
    }
  }

  async function unlinkAll() {
    if (!window.confirm('¿Desvincular Telegram de tu cuenta (todos tus chats)?')) return
    setBusy(true)
    setMsg(null)
    try {
      const { res, data } = await apiFetch('/api/telegram/link', { method: 'DELETE' })
      if (res.ok) {
        const body = data as unknown as { unlinked?: number }
        setLink(null)
        setMsg({ kind: 'ok', text: `Desvinculado (${body.unlinked ?? 0} chat(s))` })
        await loadStatus()
      } else if (res.status === 503) {
        setMsg({ kind: 'neutral', text: 'Telegram no está habilitado en este despliegue' })
      } else {
        setMsg({ kind: 'neutral', text: data.error ?? 'Error al desvincular' })
      }
    } catch {
      setMsg({ kind: 'neutral', text: 'Error de red' })
    } finally {
      setBusy(false)
    }
  }

  async function testBot() {
    setBusy(true)
    setMsg(null)
    try {
      const { res, data } = await apiFetch('/api/telegram/status', { method: 'POST' })
      if (res.ok) {
        const body = data as unknown as { webhook: { ok: boolean; lastError: string | null }; testSentTo: number }
        setMsg({
          kind: body.webhook.ok ? 'ok' : 'error',
          text:
            body.webhook.ok && body.testSentTo > 0
              ? `Bot funcionando — mensaje de prueba enviado a ${body.testSentTo} chat(s)`
              : body.webhook.ok
                ? 'Bot conectado (sin chats vinculados a tu cuenta)'
                : `Fallo de webhook: ${body.webhook.lastError ?? 'desconocido'}`,
        })
        await loadStatus()
      } else {
        setMsg({ kind: 'neutral', text: data.error ?? 'Error al probar el bot' })
      }
    } catch {
      setMsg({ kind: 'neutral', text: 'Error de red' })
    } finally {
      setBusy(false)
    }
  }

  const activeName = (id: string | null) =>
    status?.workspaces.find((w) => w.id === id)?.name ?? '—'

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-background px-4 py-2">
        <Link href="/workspaces" className="text-sm text-zinc-500 hover:text-foreground">
          ← Volver a workspaces
        </Link>
        <div className="flex-1" />
        <h1 className="text-sm font-semibold">Telegram</h1>
      </div>
      <main className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-2xl space-y-4">
          <div>
            <h2 className="text-base font-semibold">Telegram</h2>
            <p className="text-sm text-zinc-500">
              Una sola vinculación para todos tus workspaces. Cambia con{' '}
              <code className="rounded bg-muted px-1 py-0.5">/lista</code>,{' '}
              <code className="rounded bg-muted px-1 py-0.5">/usar</code> o escribiendo{' '}
              <code className="rounded bg-muted px-1 py-0.5">usa nombre-del-workspace</code> en el
              bot o en el chat web, sin revincular.
            </p>
          </div>

          {msg ? (
            <p
              role={msg.kind === 'error' ? 'alert' : 'status'}
              className={`text-sm ${
                msg.kind === 'error'
                  ? 'text-red-600'
                  : msg.kind === 'neutral'
                    ? 'text-zinc-500'
                    : 'text-green-600'
              }`}
            >
              {msg.text}
            </p>
          ) : null}

          <div className="space-y-3 rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold">Estado del bot</h3>
            {status === null ? (
              <p className="text-sm text-zinc-500">Consultando…</p>
            ) : !status.enabled ? (
              <p className="text-sm text-zinc-500">
                Telegram no está habilitado en este despliegue (falta configuración del bot).
              </p>
            ) : (
              <>
                <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-medium text-zinc-500">Bot</dt>
                    <dd className="font-medium">@{status.botUsername ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-zinc-500">Webhook</dt>
                    <dd>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                          status.webhook?.ok
                            ? 'bg-emerald-500/15 text-emerald-600'
                            : 'bg-red-500/15 text-red-600'
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            status.webhook?.ok ? 'bg-emerald-500' : 'bg-red-500'
                          }`}
                        />
                        {status.webhook?.ok ? 'Conectado' : 'Desconectado'}
                      </span>
                    </dd>
                  </div>
                  {status.webhook?.lastError ? (
                    <div className="sm:col-span-2">
                      <dt className="text-xs font-medium text-zinc-500">Último error del bot</dt>
                      <dd className="text-sm text-red-600">
                        {status.webhook.lastError}
                        {status.webhook.lastErrorDate ? ` (${formatDate(status.webhook.lastErrorDate)})` : null}
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="text-xs font-medium text-zinc-500">Mis chats vinculados</dt>
                    <dd className="font-medium">{status.chats.length}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-zinc-500">Actualizaciones pendientes</dt>
                    <dd className="font-medium">{status.webhook?.pendingUpdateCount ?? 0}</dd>
                  </div>
                </dl>

                {status.chats.length > 0 ? (
                  <ul className="divide-y divide-border rounded-md border border-border text-sm">
                    {status.chats.map((c) => (
                      <li key={`${c.chatId}:${c.tgUserId}`} className="flex items-center justify-between gap-2 px-3 py-2">
                        <span className="font-mono text-xs">{c.chatId}</span>
                        <span className="text-xs text-zinc-500">
                          activo: {activeName(c.activeWorkspaceId)} · {formatDate(c.lastActivityAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={testBot} disabled={busy} className="h-11">
                    {busy ? 'Probando…' : 'Probar bot'}
                  </Button>
                  <span className="text-xs text-zinc-500">
                    Envía un mensaje de prueba a tus chats vinculados.
                  </span>
                </div>
              </>
            )}
          </div>

          {status?.workspaces && status.workspaces.length > 0 ? (
            <div className="space-y-2 rounded-lg border border-border p-4">
              <h3 className="text-sm font-semibold">Workspaces listos para usar</h3>
              <ul className="divide-y divide-border rounded-md border border-border text-sm">
                {status.workspaces.map((w) => (
                  <li key={w.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="font-medium">{w.name}</span>
                    <Link href={`/w/${w.slug}`} className="font-mono text-xs text-zinc-500 hover:text-foreground">
                      /w/{w.slug}
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-zinc-500">
                En el bot o en el chat web escribe <code className="rounded bg-muted px-1 py-0.5">usa nombre</code> para
                cambiar sin revincular.
              </p>
            </div>
          ) : null}

          <div className="space-y-3 rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold">Vincular</h3>
            {link ? (
              <>
                <div className="rounded-md bg-muted/50 px-3 py-2 font-mono text-lg tracking-widest">
                  {link.code}
                </div>
                <p className="text-sm text-zinc-600">
                  Envía <code className="rounded bg-muted px-1 py-0.5">/link {link.code}</code> a tu
                  bot de Telegram desde tu cuenta personal.
                </p>
                <p className="text-xs text-zinc-500">
                  El código expira el {formatDate(link.expiresAt)} ({link.ttlSeconds}s). Un solo uso.
                </p>
                <Button variant="outline" onClick={unlinkAll} disabled={busy} className="h-11">
                  Desvincular todo
                </Button>
              </>
            ) : (
              <>
                {status && status.workspaces.length > 1 ? (
                  <div className="space-y-1">
                    <label htmlFor="tg-initial-ws" className="text-sm font-medium">
                      Workspace activo inicial (opcional)
                    </label>
                    <select
                      id="tg-initial-ws"
                      value={initialWs}
                      onChange={(e) => setInitialWs(e.target.value)}
                      className="h-11 w-full rounded-lg border border-border bg-background px-3 text-base outline-none focus-visible:border-ring sm:text-sm"
                    >
                      <option value="">Sin activo — elegiré con /lista</option>
                      {status.workspaces.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <div className="flex items-center gap-2">
                  <Button onClick={generateCode} disabled={busy} className="h-11">
                    {busy ? 'Generando...' : 'Generar código'}
                  </Button>
                  {status && status.chats.length > 0 ? (
                    <Button variant="outline" onClick={unlinkAll} disabled={busy} className="h-11">
                      Desvincular todo
                    </Button>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
