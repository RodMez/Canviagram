'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, Check, BellRing } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

// ============================================================
// Campana de notificaciones (Fase 3)
//
// - Polling cada 60s a GET /api/notifications (no leídas del usuario).
// - Badge con el nº de no leídas; dropdown con la lista.
// - "Marcar todas como leídas" → PATCH /api/notifications.
// - Toggle de Web Push: solicita permiso, registra /sw.js, se suscribe
//   y registra la suscripción en el workspace (best-effort).
// ============================================================

type AppNotification = {
  id: string
  kind: 'reminder' | 'mention' | 'system'
  title: string
  body: string
  nodeId: string | null
  workspaceId: string
  workspaceName: string
  createdAt: string | null
}

const POLL_MS = 60_000

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i)
  return out
}

export function NotificationBell({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AppNotification[]>([])
  const [pushState, setPushState] = useState<'off' | 'on' | 'unsupported' | 'error'>('off')
  const [busy, setBusy] = useState(false)
  const subscribedRef = useRef(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications')
      if (!res.ok) return
      const data = (await res.json()) as { notifications: AppNotification[] }
      setItems(data.notifications ?? [])
    } catch (err) {
      console.error('[NotificationBell] load failed', err)
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [load])

  // Inicializa el estado del toggle de push según suscripción existente.
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushState('unsupported')
      return
    }
    let cancelled = false
    navigator.serviceWorker
      .getRegistration('/sw.js')
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => {
        if (cancelled) return
        setPushState(sub ? 'on' : 'off')
        subscribedRef.current = Boolean(sub)
      })
      .catch(() => {
        if (!cancelled) setPushState('off')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const enablePush = async () => {
    setBusy(true)
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setPushState('unsupported')
        return
      }
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') {
        setPushState('off')
        return
      }
      const reg = await navigator.serviceWorker.register('/sw.js')
      const configRes = await fetch('/api/push/config')
      const config = (await configRes.json()) as { enabled: boolean; vapidPublicKey: string | null }
      if (!config.enabled || !config.vapidPublicKey) {
        setPushState('error')
        return
      }
      let sub = await reg.pushManager.getSubscription()
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey) as BufferSource,
        })
      }
      const json = sub.toJSON() as { endpoint: string; keys?: { auth?: string; p256dh?: string } }
      await fetch(`/api/workspaces/${workspaceId}/push/subscription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys ?? {} }),
      })
      subscribedRef.current = true
      setPushState('on')
    } catch (err) {
      console.error('[NotificationBell] enable push failed', err)
      setPushState('error')
    } finally {
      setBusy(false)
    }
  }

  const disablePush = async () => {
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        const json = sub.toJSON() as { endpoint: string }
        try {
          await fetch(`/api/workspaces/${workspaceId}/push/subscription`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: json.endpoint }),
          })
        } catch {
          // best-effort
        }
        await sub.unsubscribe()
      }
      subscribedRef.current = false
      setPushState('off')
    } catch (err) {
      console.error('[NotificationBell] disable push failed', err)
    } finally {
      setBusy(false)
    }
  }

  const markAllRead = async () => {
    const ids = items.map((n) => n.id)
    if (ids.length === 0) return
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      setItems([])
    } catch (err) {
      console.error('[NotificationBell] mark read failed', err)
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Notificaciones"
        className="relative flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-muted"
      >
        <Bell className="h-4 w-4" />
        {items.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
            {items.length > 9 ? '9+' : items.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-lg border bg-popover shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-semibold">Notificaciones</span>
            {items.length > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Check className="h-3 w-3" /> Marcar leídas
              </button>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                Sin notificaciones nuevas
              </p>
            ) : (
              items.map((n) => (
                <div key={n.id} className="border-b border-border/50 px-3 py-2">
                  <p className="text-xs font-medium">{n.title}</p>
                  <p className="text-xs text-muted-foreground">{n.body}</p>
                  {n.workspaceName && (
                    <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                      {n.workspaceName}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="flex items-center justify-between border-t border-border px-3 py-2">
            <span className="text-xs text-muted-foreground">Notificaciones del navegador</span>
            {pushState === 'unsupported' ? (
              <span className="text-[10px] text-muted-foreground">No soportado</span>
            ) : pushState === 'on' ? (
              <button
                onClick={disablePush}
                disabled={busy}
                className="rounded bg-muted px-2 py-1 text-xs font-medium hover:bg-muted/70 disabled:opacity-50"
              >
                <BellRing className="mr-1 inline h-3 w-3" /> Activas
              </button>
            ) : (
              <button
                onClick={enablePush}
                disabled={busy}
                className={cn(
                  'rounded px-2 py-1 text-xs font-medium disabled:opacity-50',
                  pushState === 'error'
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-primary text-primary-foreground hover:opacity-90'
                )}
              >
                Activar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}