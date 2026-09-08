'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'

// ============================================================
// Catálogo de templates (Fase 0): lista estática del servidor y
// materialización de un template en el workspace actual.
// ============================================================

type TemplateSummary = {
  id: string
  name: string
  emoji: string
  description: string
  nodeCount: number
  edgeCount: number
}

type TemplatesModalProps = {
  workspaceId: string
  open: boolean
  onClose: () => void
  /** Se invoca tras materializar el template (el padre recarga el grafo). */
  onApplied: () => void
}

export function TemplatesModal({ workspaceId, open, onClose, onApplied }: TemplatesModalProps) {
  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setError(null)
    setLoading(true)
    fetch('/api/templates')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('fetch failed'))))
      .then((data: { templates: TemplateSummary[] }) => {
        if (!cancelled) setTemplates(data.templates ?? [])
      })
      .catch(() => {
        if (!cancelled) setError('No se pudo cargar el catálogo de templates')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const handleApply = useCallback(
    async (templateId: string) => {
      if (applying) return
      setApplying(templateId)
      setError(null)
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/templates/apply`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ templateId }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          setError((data as { error?: string })?.error ?? 'No se pudo aplicar el template')
          return
        }
        onApplied()
      } catch {
        setError('Error de red al aplicar el template')
      } finally {
        setApplying(null)
      }
    },
    [workspaceId, applying, onApplied]
  )

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Templates de proyecto"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Templates de proyecto</h2>
            <p className="text-xs text-muted-foreground">
              Crea un proyecto con tareas, descripciones y dependencias ya ordenadas.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto p-5">
          {error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando templates...
            </div>
          ) : (
            templates.map((t) => (
              <div key={t.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{t.emoji}</span>
                    <div>
                      <h3 className="text-sm font-semibold">{t.name}</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {t.nodeCount} nodos · {t.edgeCount} enlaces
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleApply(t.id)}
                    disabled={applying !== null}
                    className="shrink-0 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {applying === t.id ? (
                      <span className="flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Creando
                      </span>
                    ) : (
                      'Usar'
                    )}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}