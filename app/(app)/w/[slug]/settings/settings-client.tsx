'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

// ============================================================
// Tipos (shapes de las rutas API F4.3)
// ============================================================

type WorkspaceSettings = {
  id: string
  name: string
  slug: string
  description: string | null
  role: string
}

type Member = {
  userId: string
  displayName: string
  email: string
  role: string
  joinedAt: string | null
  isOwner: boolean
}

type Invitation = {
  id: string
  email: string
  role: string
  expiresAt: string
  acceptedAt: string | null
  expired: boolean
}

type TelegramLink = {
  code: string
  expiresAt: string
  ttlSeconds: number
  workspaceId: string
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
  chats: Array<{ chatId: string; tgUserId: string; lastActivityAt: string | null }>
  canAdmin: boolean
}

type Feedback = { kind: 'error' | 'ok' | 'neutral'; text: string }

const ROLE_LABELS: Record<string, string> = {
  owner: 'Propietario',
  admin: 'Admin',
  member: 'Miembro',
  viewer: 'Viewer',
}

const INVITE_ROLES = ['admin', 'member', 'viewer'] as const

type Tab = 'general' | 'members' | 'telegram' | 'danger'

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

// ============================================================
// Componente
// ============================================================

export default function SettingsClient({
  workspace,
  userId,
}: {
  workspace: WorkspaceSettings
  userId: string
}) {
  const router = useRouter()
  const isOwner = workspace.role === 'owner'
  const canAdmin = workspace.role === 'owner' || workspace.role === 'admin'

  const [tab, setTab] = useState<Tab>('general')

  // General
  const [name, setName] = useState(workspace.name)
  const [slug, setSlug] = useState(workspace.slug)
  const [description, setDescription] = useState(workspace.description ?? '')
  const [generalMsg, setGeneralMsg] = useState<Feedback | null>(null)
  const [saving, setSaving] = useState(false)

  // Miembros
  const [members, setMembers] = useState<Member[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [membersMsg, setMembersMsg] = useState<Feedback | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<string>('member')
  const [inviting, setInviting] = useState(false)

  // Telegram
  const [telegramLink, setTelegramLink] = useState<TelegramLink | null>(null)
  const [telegramMsg, setTelegramMsg] = useState<Feedback | null>(null)
  const [telegramBusy, setTelegramBusy] = useState(false)
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus | null>(null)

  // Peligro
  const [confirmSlug, setConfirmSlug] = useState('')
  const [dangerMsg, setDangerMsg] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Fetch helper: parsea { error }, redirige a /login en 401
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

  const loadMembers = useCallback(async () => {
    const { res, data } = await apiFetch(`/api/workspaces/${workspace.id}/members`)
    if (res.ok) {
      const body = data as unknown as { members: Member[]; invitations: Invitation[] }
      setMembers(body.members)
      setInvitations(body.invitations)
    }
  }, [apiFetch, workspace.id])

  // Miembros: carga al montar
  useEffect(() => {
    loadMembers()
  }, [loadMembers])

  // ============================================================
  // General
  // ============================================================

  async function saveGeneral() {
    setSaving(true)
    setGeneralMsg(null)
    try {
      const body: { name?: string; slug?: string; description?: string | null } = {}
      if (name !== workspace.name) body.name = name
      if (slug !== workspace.slug) body.slug = slug
      // F5.1: la descripción del proyecto vive en el workspace (nullable).
      const trimmedDescription = description.trim()
      const nextDescription = trimmedDescription === '' ? null : trimmedDescription
      if (nextDescription !== (workspace.description ?? null)) body.description = nextDescription

      if (Object.keys(body).length === 0) {
        setGeneralMsg({ kind: 'ok', text: 'Sin cambios' })
        return
      }

      const { res, data } = await apiFetch(`/api/workspaces/${workspace.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        setGeneralMsg({ kind: 'ok', text: 'Cambios guardados' })
        if (body.slug && body.slug !== workspace.slug) {
          // El server page remonta el client (key={slug}) con el nuevo slug
          router.push(`/w/${body.slug}/settings`)
        }
      } else if (res.status === 409) {
        setGeneralMsg({ kind: 'error', text: 'El slug ya está en uso' })
      } else {
        setGeneralMsg({ kind: 'error', text: data.error ?? 'Error al guardar' })
      }
    } catch {
      setGeneralMsg({ kind: 'error', text: 'Error de red' })
    } finally {
      setSaving(false)
    }
  }

  // ============================================================
  // Miembros
  // ============================================================

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviting(true)
    setMembersMsg(null)
    try {
      const { res, data } = await apiFetch(`/api/workspaces/${workspace.id}/members/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      })

      if (res.ok) {
        setInviteEmail('')
        setMembersMsg({ kind: 'ok', text: 'Invitación enviada' })
        await loadMembers()
      } else if (res.status === 409) {
        setMembersMsg({ kind: 'error', text: 'Este email ya es miembro del workspace' })
      } else {
        setMembersMsg({ kind: 'error', text: data.error ?? 'Error al invitar' })
      }
    } catch {
      setMembersMsg({ kind: 'error', text: 'Error de red' })
    } finally {
      setInviting(false)
    }
  }

  async function changeRole(member: Member, role: string) {
    setMembersMsg(null)
    try {
      const { res, data } = await apiFetch(
        `/api/workspaces/${workspace.id}/members/${member.userId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role }),
        }
      )
      if (res.ok) {
        await loadMembers()
      } else {
        setMembersMsg({ kind: 'error', text: data.error ?? 'Error al cambiar el rol' })
      }
    } catch {
      setMembersMsg({ kind: 'error', text: 'Error de red' })
    }
  }

  async function revoke(member: Member) {
    setMembersMsg(null)
    try {
      const { res, data } = await apiFetch(
        `/api/workspaces/${workspace.id}/members/${member.userId}`,
        { method: 'DELETE' }
      )
      if (res.ok) {
        await loadMembers()
      } else {
        setMembersMsg({ kind: 'error', text: data.error ?? 'Error al revocar' })
      }
    } catch {
      setMembersMsg({ kind: 'error', text: 'Error de red' })
    }
  }

  // ============================================================
  // Telegram
  // ============================================================

  async function generateTelegramCode() {
    setTelegramBusy(true)
    setTelegramMsg(null)
    try {
      const { res, data } = await apiFetch(`/api/workspaces/${workspace.id}/telegram/link`, {
        method: 'POST',
      })
      if (res.ok) {
        setTelegramLink(data as unknown as TelegramLink)
      } else if (res.status === 503) {
        // Nunca filtrar config interna: aviso genérico
        setTelegramMsg({ kind: 'neutral', text: 'Telegram no está habilitado en este despliegue' })
      } else {
        setTelegramMsg({ kind: 'neutral', text: data.error ?? 'Error al generar el código' })
      }
    } catch {
      setTelegramMsg({ kind: 'neutral', text: 'Error de red' })
    } finally {
      setTelegramBusy(false)
    }
  }

  async function unlinkTelegram() {
    setTelegramBusy(true)
    setTelegramMsg(null)
    try {
      const { res } = await apiFetch(`/api/workspaces/${workspace.id}/telegram/link`, {
        method: 'DELETE',
      })
      if (res.status === 204) {
        setTelegramLink(null)
      } else if (res.status === 503) {
        setTelegramMsg({ kind: 'neutral', text: 'Telegram no está habilitado en este despliegue' })
      }
    } catch {
      setTelegramMsg({ kind: 'neutral', text: 'Error de red' })
    } finally {
      setTelegramBusy(false)
    }
  }

  // Estado visible del vínculo (Fase 1): webhook + chats + último error del bot.
  const loadTelegramStatus = useCallback(async () => {
    try {
      const { res, data } = await apiFetch(`/api/workspaces/${workspace.id}/telegram/status`)
      if (res.ok) setTelegramStatus(data as unknown as TelegramStatus)
    } catch {
      // silencioso: el estado se reintenta al abrir la pestaña
    }
  }, [apiFetch, workspace.id])

  useEffect(() => {
    if (tab === 'telegram') loadTelegramStatus()
  }, [tab, loadTelegramStatus])

  async function testTelegramBot() {
    setTelegramBusy(true)
    setTelegramMsg(null)
    try {
      const { res, data } = await apiFetch(`/api/workspaces/${workspace.id}/telegram/status`, {
        method: 'POST',
      })
      if (res.ok) {
        const body = data as unknown as { webhook: { ok: boolean; lastError: string | null }; testSentTo: number }
        setTelegramMsg({
          kind: body.webhook.ok ? 'ok' : 'error',
          text:
            body.webhook.ok && body.testSentTo > 0
              ? `Bot funcionando — mensaje de prueba enviado a ${body.testSentTo} chat(s)`
              : body.webhook.ok
                ? 'Bot conectado (sin chats vinculados a este workspace como activo)'
                : `Fallo de webhook: ${body.webhook.lastError ?? 'desconocido'}`,
        })
        await loadTelegramStatus()
      } else {
        setTelegramMsg({ kind: 'neutral', text: data.error ?? 'Error al probar el bot' })
      }
    } catch {
      setTelegramMsg({ kind: 'neutral', text: 'Error de red' })
    } finally {
      setTelegramBusy(false)
    }
  }

  // ============================================================
  // Peligro (solo owner)
  // ============================================================

  async function deleteWorkspace() {
    setDeleting(true)
    setDangerMsg(null)
    try {
      const { res, data } = await apiFetch(`/api/workspaces/${workspace.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmSlug }),
      })
      if (res.status === 204) {
        router.push('/')
      } else if (res.status === 400) {
        setDangerMsg('El slug de confirmación no coincide')
      } else {
        setDangerMsg(data.error ?? 'Error al eliminar el workspace')
      }
    } catch {
      setDangerMsg('Error de red')
    } finally {
      setDeleting(false)
    }
  }

  // ============================================================
  // Render
  // ============================================================

  const tabs: { id: Tab; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'members', label: 'Miembros' },
    { id: 'telegram', label: 'Telegram' },
    // Peligro: solo visible para el owner
    ...(isOwner ? [{ id: 'danger' as Tab, label: 'Peligro' }] : []),
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Sub-navegación de secciones (el header global vive en AppShell). */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-background px-4 py-2">
        <Link href={`/w/${workspace.slug}`} className="text-sm text-zinc-500 hover:text-foreground">
          ← Volver al workspace
        </Link>
        <div className="flex-1" />
        <h1 className="text-sm font-semibold">Configuración</h1>
      </div>
      <nav className="flex shrink-0 gap-1 border-b border-border bg-background px-4 pt-2" aria-label="Secciones de configuración">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-t-lg border-b-2 px-3 py-2 text-sm transition-colors ${
              tab === t.id
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-zinc-500 hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Contenido */}
      <main className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-2xl space-y-6">
          {/* ============ GENERAL ============ */}
          {tab === 'general' ? (
            <section className="space-y-4">
              <div>
                <h2 className="text-base font-semibold">General</h2>
                <p className="text-sm text-zinc-500">
                  Rol actual: <span className="font-medium text-foreground">{ROLE_LABELS[workspace.role] ?? workspace.role}</span>
                </p>
              </div>

              <div className="space-y-1">
                <label htmlFor="ws-name" className="text-sm font-medium">
                  Nombre
                </label>
                <input
                  id="ws-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={!canAdmin}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring disabled:opacity-60"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="ws-slug" className="text-sm font-medium">
                  Slug
                </label>
                <input
                  id="ws-slug"
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  disabled={!canAdmin}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring disabled:opacity-60"
                />
                <p className="text-xs text-zinc-500">Identificador único de la URL del workspace.</p>
              </div>

              <div className="space-y-1">
                <label htmlFor="ws-description" className="text-sm font-medium">
                  Descripción
                </label>
                <textarea
                  id="ws-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={!canAdmin}
                  rows={3}
                  maxLength={5000}
                  placeholder="¿De qué trata este proyecto?"
                  className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring disabled:opacity-60"
                />
                <p className="text-xs text-zinc-500">Qué es este proyecto y en qué punto está. Vacía para quitarla.</p>
              </div>

              {generalMsg ? (
                <p
                  role={generalMsg.kind === 'error' ? 'alert' : 'status'}
                  className={`text-sm ${
                    generalMsg.kind === 'error'
                      ? 'text-red-600'
                      : generalMsg.kind === 'ok'
                        ? 'text-green-600'
                        : 'text-zinc-500'
                  }`}
                >
                  {generalMsg.text}
                </p>
              ) : null}

              {canAdmin ? (
                <Button onClick={saveGeneral} disabled={saving}>
                  {saving ? 'Guardando...' : 'Guardar cambios'}
                </Button>
              ) : null}
            </section>
          ) : null}

          {/* ============ MIEMBROS ============ */}
          {tab === 'members' ? (
            <section className="space-y-6">
              <div>
                <h2 className="text-base font-semibold">Miembros</h2>
                <p className="text-sm text-zinc-500">
                  {canAdmin
                    ? 'Invita personas y gestiona sus roles.'
                    : 'Solo lectura: pide a un administrador que gestione los miembros.'}
                </p>
              </div>

              {membersMsg ? (
                <p
                  role={membersMsg.kind === 'error' ? 'alert' : 'status'}
                  className={`text-sm ${
                    membersMsg.kind === 'error'
                      ? 'text-red-600'
                      : membersMsg.kind === 'ok'
                        ? 'text-green-600'
                        : 'text-zinc-500'
                  }`}
                >
                  {membersMsg.text}
                </p>
              ) : null}

              {/* Tabla de miembros */}
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Usuario</th>
                      <th className="px-3 py-2 font-medium">Rol</th>
                      <th className="px-3 py-2 font-medium">Se unió</th>
                      {canAdmin ? <th className="px-3 py-2 font-medium">Acciones</th> : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {members.map((m) => (
                      <tr key={m.userId}>
                        <td className="px-3 py-2">
                          <div className="font-medium">{m.displayName || m.email}</div>
                          <div className="text-xs text-zinc-500">{m.email}</div>
                        </td>
                        <td className="px-3 py-2">
                          {m.isOwner ? (
                            <span className="inline-flex rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium">
                              {ROLE_LABELS[m.role] ?? m.role}
                            </span>
                          ) : canAdmin && m.userId !== userId ? (
                            <select
                              value={m.role}
                              onChange={(e) => changeRole(m, e.target.value)}
                              className="rounded-lg border border-border bg-background px-2 py-1 text-sm outline-none focus-visible:border-ring"
                            >
                              {INVITE_ROLES.map((r) => (
                                <option key={r} value={r}>
                                  {ROLE_LABELS[r]}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-zinc-700">{ROLE_LABELS[m.role] ?? m.role}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-zinc-500">{formatDate(m.joinedAt)}</td>
                        {canAdmin ? (
                          <td className="px-3 py-2">
                            {!m.isOwner && m.userId !== userId ? (
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => revoke(m)}
                              >
                                Revocar
                              </Button>
                            ) : null}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Invitaciones pendientes */}
              {invitations.length > 0 ? (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Invitaciones pendientes</h3>
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {invitations.map((inv) => (
                      <li key={inv.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <div>
                          <div className="font-medium">{inv.email}</div>
                          <div className="text-xs text-zinc-500">
                            {ROLE_LABELS[inv.role] ?? inv.role} · expira {formatDate(inv.expiresAt)}
                          </div>
                        </div>
                        {inv.expired ? (
                          <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
                            Expirada
                          </span>
                        ) : (
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                            Pendiente
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Form invite (solo admin+) */}
              {canAdmin ? (
                <form onSubmit={submitInvite} className="space-y-3 rounded-lg border border-border p-4">
                  <h3 className="text-sm font-semibold">Invitar miembro</h3>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="email"
                      required
                      placeholder="email@ejemplo.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring"
                    />
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}
                      className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring"
                    >
                      {INVITE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                    <Button type="submit" disabled={inviting}>
                      {inviting ? 'Enviando...' : 'Invitar'}
                    </Button>
                  </div>
                </form>
              ) : null}
            </section>
          ) : null}

          {/* ============ TELEGRAM ============ */}
          {tab === 'telegram' ? (
            <section className="space-y-4">
              <div>
                <h2 className="text-base font-semibold">Telegram</h2>
                <p className="text-sm text-zinc-500">
                  Vincula tu bot de Telegram con tu cuenta para trabajar desde el chat y recibir
                  notificaciones. Un mismo chat puede cambiar de workspace con{' '}
                  <code className="rounded bg-muted px-1 py-0.5">/lista</code> y{' '}
                  <code className="rounded bg-muted px-1 py-0.5">/usar &lt;slug&gt;</code>.
                </p>
              </div>

              {telegramMsg ? (
                <p
                  role={telegramMsg.kind === 'error' ? 'alert' : 'status'}
                  className={`text-sm ${
                    telegramMsg.kind === 'error'
                      ? 'text-red-600'
                      : telegramMsg.kind === 'neutral'
                        ? 'text-zinc-500'
                        : 'text-green-600'
                  }`}
                >
                  {telegramMsg.text}
                </p>
              ) : null}

              {/* Estado visible del vínculo (Fase 1) */}
              <div className="space-y-3 rounded-lg border border-border p-4">
                <h3 className="text-sm font-semibold">Estado del bot</h3>
                {telegramStatus === null ? (
                  <p className="text-sm text-zinc-500">Consultando…</p>
                ) : !telegramStatus.enabled ? (
                  <p className="text-sm text-zinc-500">
                    Telegram no está habilitado en este despliegue (falta configuración del bot).
                  </p>
                ) : (
                  <>
                    <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-xs font-medium text-zinc-500">Bot</dt>
                        <dd className="font-medium">@{telegramStatus.botUsername ?? '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-zinc-500">Webhook</dt>
                        <dd>
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                              telegramStatus.webhook?.ok
                                ? 'bg-emerald-500/15 text-emerald-600'
                                : 'bg-red-500/15 text-red-600'
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                telegramStatus.webhook?.ok ? 'bg-emerald-500' : 'bg-red-500'
                              }`}
                            />
                            {telegramStatus.webhook?.ok ? 'Conectado' : 'Desconectado'}
                          </span>
                        </dd>
                      </div>
                      {telegramStatus.webhook?.lastError ? (
                        <div className="sm:col-span-2">
                          <dt className="text-xs font-medium text-zinc-500">Último error del bot</dt>
                          <dd className="text-sm text-red-600">
                            {telegramStatus.webhook.lastError}
                            {telegramStatus.webhook.lastErrorDate
                              ? ` (${formatDate(telegramStatus.webhook.lastErrorDate)})`
                              : null}
                          </dd>
                        </div>
                      ) : null}
                      <div>
                        <dt className="text-xs font-medium text-zinc-500">Chats vinculados (activos aquí)</dt>
                        <dd className="font-medium">{telegramStatus.chats.length}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-zinc-500">Actualizaciones pendientes</dt>
                        <dd className="font-medium">{telegramStatus.webhook?.pendingUpdateCount ?? 0}</dd>
                      </div>
                    </dl>

                    {telegramStatus.chats.length > 0 ? (
                      <ul className="divide-y divide-border rounded-md border border-border text-sm">
                        {telegramStatus.chats.map((c) => (
                          <li key={`${c.chatId}:${c.tgUserId}`} className="flex items-center justify-between px-3 py-2">
                            <span className="font-mono text-xs">{c.chatId}</span>
                            <span className="text-xs text-zinc-500">
                              última actividad {formatDate(c.lastActivityAt)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {telegramStatus.canAdmin ? (
                      <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={testTelegramBot} disabled={telegramBusy}>
                          {telegramBusy ? 'Probando…' : 'Probar bot'}
                        </Button>
                        <span className="text-xs text-zinc-500">
                          Envía un mensaje de prueba a los chats vinculados.
                        </span>
                      </div>
                    ) : null}
                  </>
                )}
              </div>

              {canAdmin ? (
                telegramLink ? (
                  <div className="space-y-3 rounded-lg border border-border p-4">
                    <div className="rounded-md bg-muted/50 px-3 py-2 font-mono text-lg tracking-widest">
                      {telegramLink.code}
                    </div>
                    <p className="text-sm text-zinc-600">
                      Envía <code className="rounded bg-muted px-1 py-0.5">/link {telegramLink.code}</code> a tu
                      bot de Telegram desde tu cuenta personal.
                    </p>
                    <p className="text-xs text-zinc-500">
                      El código expira el {formatDate(telegramLink.expiresAt)} ({telegramLink.ttlSeconds}s).
                    </p>
                    <Button variant="outline" onClick={unlinkTelegram} disabled={telegramBusy}>
                      Desvincular
                    </Button>
                  </div>
                ) : (
                  <Button onClick={generateTelegramCode} disabled={telegramBusy}>
                    {telegramBusy ? 'Generando...' : 'Generar código'}
                  </Button>
                )
              ) : (
                <p className="text-sm text-zinc-500">
                  Telegram no está habilitado en este despliegue.
                </p>
              )}
            </section>
          ) : null}

          {/* ============ PELIGRO (solo owner) ============ */}
          {tab === 'danger' && isOwner ? (
            <section className="space-y-4">
              <div>
                <h2 className="text-base font-semibold text-red-600">Zona de peligro</h2>
                <p className="text-sm text-zinc-500">
                  Eliminar el workspace borra permanentemente todos los nodos, conexiones y miembros.
                  Esta acción no se puede deshacer.
                </p>
              </div>

              {dangerMsg ? (
                <p role="alert" className="text-sm text-red-600">
                  {dangerMsg}
                </p>
              ) : null}

              <div className="space-y-1">
                <label htmlFor="confirm-slug" className="text-sm font-medium">
                  Escribe <code className="rounded bg-muted px-1 py-0.5">{workspace.slug}</code> para confirmar
                </label>
                <input
                  id="confirm-slug"
                  type="text"
                  value={confirmSlug}
                  onChange={(e) => setConfirmSlug(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring"
                />
              </div>

              <Button
                variant="destructive"
                onClick={deleteWorkspace}
                disabled={deleting || confirmSlug !== workspace.slug}
              >
                {deleting ? 'Eliminando...' : 'Eliminar workspace'}
              </Button>
            </section>
          ) : null}
        </div>
      </main>
    </div>
  )
}