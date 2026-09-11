'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

// ============================================================
// Configuración de la instancia (F5.5): modelo de IA activo +
// lista de respaldo (uno por línea). Sin redeploy: vive en DB.
// Estrategia "free primero, pago si falla": se intenta el modelo
// activo en cada request y se cae al primero de la lista si falla.
// ============================================================

type Feedback = { kind: 'error' | 'ok'; text: string }

export function AdminSettingsClient() {
  const router = useRouter()
  const [model, setModel] = useState('')
  const [fallbackText, setFallbackText] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [msg, setMsg] = useState<Feedback | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/settings')
      if (res.status === 401) {
        router.push('/login?next=/admin/settings')
        return
      }
      if (res.status === 403) {
        router.push('/')
        return
      }
      if (!res.ok) throw new Error('failed')
      const data = (await res.json()) as { model: string; fallback: string[] }
      setModel(data.model ?? '')
      setFallbackText((data.fallback ?? []).join('\n'))
      setLoaded(true)
    } catch {
      setMsg({ kind: 'error', text: 'No se pudo cargar la configuración' })
    }
  }, [router])

  useEffect(() => {
    load()
  }, [load])

  async function onSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMsg(null)
    try {
      const fallback = fallbackText
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model.trim(), fallback }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; model?: string; fallback?: string[] }
      if (res.ok && data.model) {
        setModel(data.model)
        setFallbackText((data.fallback ?? []).join('\n'))
        setMsg({ kind: 'ok', text: 'Configuración guardada (aplica de inmediato, sin redeploy)' })
      } else {
        setMsg({ kind: 'error', text: data.error ?? 'Error al guardar' })
      }
    } catch {
      setMsg({ kind: 'error', text: 'Error de red' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <main className="mx-auto w-full max-w-2xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Modelo de IA</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Solo administradores. El cambio aplica en ~1 minuto como máximo, sin redeploy.
        </p>

        {!loaded && !msg ? <p className="mt-6 text-sm text-muted-foreground">Cargando...</p> : null}
        {msg ? (
          <p role={msg.kind === 'error' ? 'alert' : 'status'} className={`mt-4 text-sm ${msg.kind === 'error' ? 'text-red-600' : 'text-green-600'}`}>
            {msg.text}
          </p>
        ) : null}

        {loaded ? (
          <form onSubmit={onSave} className="mt-6 space-y-4">
            <div className="space-y-1">
              <label htmlFor="ai-model" className="text-sm font-medium">
                Modelo activo
              </label>
              <input
                id="ai-model"
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="openrouter/free"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring"
              />
              <p className="text-xs text-zinc-500">Se intenta primero en cada request (ej. el free hasta agotar cuota).</p>
            </div>

            <div className="space-y-1">
              <label htmlFor="ai-fallback" className="text-sm font-medium">
                Modelos de respaldo (uno por línea)
              </label>
              <textarea
                id="ai-fallback"
                value={fallbackText}
                onChange={(e) => setFallbackText(e.target.value)}
                rows={4}
                placeholder={'anthropic/claude-sonnet-4\nopenai/gpt-4o-mini'}
                className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:border-ring"
              />
              <p className="text-xs text-zinc-500">
                Si el activo falla (modelo dado de baja o rate-limit), se usa el primero disponible. Te avisa por Telegram.
              </p>
            </div>

            <Button type="submit" disabled={saving || model.trim().length === 0}>
              {saving ? 'Guardando...' : 'Guardar'}
            </Button>
          </form>
        ) : null}
      </main>
    </div>
  )
}
