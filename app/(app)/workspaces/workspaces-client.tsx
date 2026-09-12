'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { createWorkspaceSchema } from '@/lib/validators/workspace'

type WorkspaceListItem = {
  id: string
  name: string
  slug: string
  role: 'owner' | 'viewer' | 'member' | 'admin'
  createdAt: string
}

export function WorkspacesClient() {
  const router = useRouter()
  const [workspaces, setWorkspaces] = useState<WorkspaceListItem[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [rootError, setRootError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  const loadWorkspaces = useCallback(async () => {
    try {
      const res = await fetch('/api/workspaces')
      if (!res.ok) throw new Error('failed')
      const data = (await res.json()) as { workspaces: WorkspaceListItem[] }
      setWorkspaces(data.workspaces ?? [])
      setLoadError(null)
    } catch {
      setLoadError('No se pudieron cargar los workspaces')
    }
  }, [])

  useEffect(() => {
    loadWorkspaces()
  }, [loadWorkspaces])

  // Derivación automática del slug a partir del nombre (sobrescribible).
  function handleNameChange(value: string) {
    setName(value)
    setSlug(
      value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50)
    )
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    setRootError(null)
    setFieldErrors({})
    const parsed = createWorkspaceSchema.safeParse({ name, slug })
    if (!parsed.success) {
      setFieldErrors(parsed.error.flatten().fieldErrors as Record<string, string[]>)
      return
    }
    setIsCreating(true)
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: parsed.data.name, slug: parsed.data.slug }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        details?: { fieldErrors?: Record<string, string[]> }
        workspace?: { slug: string }
      }
      if (res.ok && data.workspace) {
        router.push(`/w/${data.workspace.slug}`)
        return
      }
      if (res.status === 409 || data.error) {
        setRootError(data.error ?? 'El slug ya está en uso')
        return
      }
      if (res.status === 400 && data.details?.fieldErrors) {
        setFieldErrors(data.details.fieldErrors)
        return
      }
      setRootError('Error al crear el workspace')
    } catch {
      setRootError('Error de red')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Tus workspaces</h1>

        <section className="mt-6 rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium">Crear workspace</h2>
          {rootError ? (
            <p role="alert" className="mt-2 text-xs text-red-600">
              {rootError}
            </p>
          ) : null}
          <form onSubmit={onCreate} noValidate className="mt-3 space-y-3">
            <div>
              <label htmlFor="ws-name" className="mb-1 block text-sm font-medium">
                Nombre
              </label>
              <input
                id="ws-name"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                disabled={isCreating}
                aria-invalid={Boolean(fieldErrors.name)}
                className="h-11 w-full rounded-lg border border-border bg-background px-3 text-base outline-none transition-shadow focus:ring-2 focus:ring-ring disabled:opacity-50 sm:text-sm"
                placeholder="Mi proyecto"
              />
              {fieldErrors.name?.[0] ? (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.name[0]}</p>
              ) : null}
            </div>
            <div>
              <label htmlFor="ws-slug" className="mb-1 block text-sm font-medium">
                Slug
              </label>
              <input
                id="ws-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 50))}
                disabled={isCreating}
                aria-invalid={Boolean(fieldErrors.slug)}
                className="h-11 w-full rounded-lg border border-border bg-background px-3 font-mono text-base outline-none transition-shadow focus:ring-2 focus:ring-ring disabled:opacity-50 sm:text-sm"
                placeholder="mi-proyecto"
              />
              {fieldErrors.slug?.[0] ? (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.slug[0]}</p>
              ) : null}
            </div>
            <button
              type="submit"
              disabled={isCreating}
              className="flex h-11 min-w-28 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 active:opacity-80 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {isCreating ? 'Creando...' : 'Crear workspace'}
            </button>
          </form>
        </section>

        <section className="mt-6">
          <h2 className="text-sm font-medium">{workspaces === null ? 'Cargando...' : 'Workspaces'}</h2>
          {loadError ? <p className="mt-2 text-xs text-red-600">{loadError}</p> : null}
          {workspaces !== null && workspaces.length === 0 && !loadError ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Aún no tienes workspaces. Crea el primero arriba.
            </p>
          ) : null}
          <ul className="mt-2 space-y-2">
            {(workspaces ?? []).map((w) => (
              <li key={w.id}>
                <Link
                  href={`/w/${w.slug}`}
                  className="flex min-h-14 items-center justify-between rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-muted/50 active:bg-muted/70"
                >
                  <span className="font-medium">{w.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {w.role === 'owner' ? 'Propietario' : w.role}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  )
}