'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

type InviteStatus =
  | 'pending'
  | 'accepted'
  | 'expired'
  | 'used'
  | 'other-account'
  | 'already-member'
  | 'not-found'
  | 'error'

type InviteClientProps = {
  token: string
}

export default function InviteClient({ token }: InviteClientProps) {
  const [status, setStatus] = useState<InviteStatus>('pending')
  const [workspace, setWorkspace] = useState<{ id: string; name: string; slug: string } | null>(null)
  const [message, setMessage] = useState<string>('')

  useEffect(() => {
    let cancelled = false

    async function accept() {
      try {
        const res = await fetch(`/api/invitations/${encodeURIComponent(token)}/accept`, {
          method: 'POST',
        })
        if (cancelled) return

        const data = await res.json().catch(() => ({}))
        const errorMsg = (data as { error?: string })?.error ?? ''

        if (res.ok) {
          const ws = (data as { workspace?: { id: string; name: string; slug: string } })?.workspace
          if (ws) {
            setWorkspace(ws)
            setStatus('accepted')
          } else {
            setStatus('error')
            setMessage('Respuesta inesperada del servidor')
          }
        } else if (res.status === 410) {
          // 410: expirada o ya utilizada — distinguir por mensaje
          if (errorMsg.includes('expirado')) {
            setStatus('expired')
          } else {
            setStatus('used')
          }
          setMessage(errorMsg)
        } else if (res.status === 403) {
          setStatus('other-account')
          setMessage(errorMsg)
        } else if (res.status === 409) {
          setStatus('already-member')
          setMessage(errorMsg)
        } else if (res.status === 404) {
          setStatus('not-found')
          setMessage(errorMsg)
        } else {
          setStatus('error')
          setMessage(errorMsg || 'Error al aceptar la invitación')
        }
      } catch {
        if (!cancelled) {
          setStatus('error')
          setMessage('Error de red')
        }
      }
    }

    accept()
    return () => {
      cancelled = true
    }
  }, [token])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 py-12">
      <div className="w-full max-w-md rounded-xl border bg-white p-6 shadow-sm">
        {status === 'pending' ? (
          <div role="status" className="py-8 text-center">
            <div className="mx-auto mb-4 h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900" />
            <p className="text-sm text-zinc-600">Aceptando invitación...</p>
          </div>
        ) : null}

        {status === 'accepted' && workspace ? (
          <div role="status" className="text-center">
            <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              ✓ ¡Invitación aceptada! Ya eres miembro de <strong>{workspace.name}</strong>.
            </div>
            <Button render={<Link href={`/w/${workspace.slug}`} />}>
              Ir al workspace
            </Button>
          </div>
        ) : null}

        {status === 'expired' ? (
          <div role="alert" className="text-center">
            <div className="mb-4 rounded-md border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
              {message || 'La invitación ha expirado.'}
            </div>
            <p className="text-sm text-zinc-600">
              Pide al administrador del workspace que te envíe una nueva invitación.
            </p>
          </div>
        ) : null}

        {status === 'used' ? (
          <div role="alert" className="text-center">
            <div className="mb-4 rounded-md border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
              {message || 'La invitación ya fue utilizada.'}
            </div>
            <p className="text-sm text-zinc-600">
              Si ya eres miembro, entra desde tu lista de workspaces.
            </p>
          </div>
        ) : null}

        {status === 'other-account' ? (
          <div role="alert" className="text-center">
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {message || 'Esta invitación es para otra cuenta.'}
            </div>
            <p className="text-sm text-zinc-600">
              La invitación está vinculada al email de la cuenta que la recibió. Inicia sesión con esa cuenta.
            </p>
          </div>
        ) : null}

        {status === 'already-member' ? (
          <div role="alert" className="text-center">
            <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
              {message || 'Ya eres miembro de este workspace.'}
            </div>
            <Button variant="outline" render={<Link href="/" />}>
              Ir a mis workspaces
            </Button>
          </div>
        ) : null}

        {status === 'not-found' ? (
          <div role="alert" className="text-center">
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {message || 'Invitación no encontrada.'}
            </div>
          </div>
        ) : null}

        {status === 'error' ? (
          <div role="alert" className="text-center">
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {message || 'Error al aceptar la invitación.'}
            </div>
          </div>
        ) : null}

        {status !== 'pending' && status !== 'accepted' ? (
          <p className="mt-6 text-center text-sm">
            <Link href="/" className="text-zinc-600 underline">
              Volver al inicio
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  )
}