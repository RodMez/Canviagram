'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FolderKanban, Plus } from 'lucide-react'
import { createWorkspaceSchema } from '@/lib/validators/workspace'

type WorkspaceListItem = {
  id: string
  name: string
  slug: string
  role: 'owner' | 'viewer' | 'member' | 'admin'
  createdAt: string
}

type WorkspacesClientProps = {
  userName: string | null
  userEmail: string | null
}

export function WorkspacesClient({ userName, userEmail }: WorkspacesClientProps) {
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
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4">
        <Link href="/workspaces" className="flex items-center gap-2 text-sm font-semibold">
          <FolderKanban className="h-5 w-5 text-primary" />
          <span>Canviagram</span>
        </Link>
        <div className="flex-1" />
        <div className="flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-sm">
          <span className="font-medium">{userName ?? 'Usuario'}</span>
          {userEmail ? <span className="text-xs text-muted-foreground">{userEmail}</span> : null}
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-6 py-10">
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
                className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-900 disabled:opacity-50"
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
                className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-900 disabled:opacity-50"
                placeholder="mi-proyecto"
              />
              {fieldErrors.slug?.[0] ? (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.slug[0]}</p>
              ) : null}
            </div>
            <button
              type="submit"
              disabled={isCreating}
              className="flex items-center gap-2 rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
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
                  className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 hover:bg-muted/50"
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