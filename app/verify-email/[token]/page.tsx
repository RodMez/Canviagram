"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { Button } from "@/components/ui/button"

type Status = "pending" | "success" | "expired" | "notfound" | "error"

export default function VerifyEmailPage() {
  const params = useParams() as { token?: string }
  const token = typeof params.token === "string" ? params.token : ""

  const [status, setStatus] = useState<Status>("pending")
  const [message, setMessage] = useState<string>("")
  const [email, setEmail] = useState("")
  const [resendLoading, setResendLoading] = useState(false)
  const [resendMsg, setResendMsg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function verify() {
      if (!token) {
        if (!cancelled) {
          setStatus("notfound")
          setMessage("Token no encontrado")
        }
        return
      }
      try {
        const res = await fetch(`/api/auth/verify-email/${encodeURIComponent(token)}`, {
          method: "GET",
        })
        if (cancelled) return
        const data = await res.json().catch(() => ({}))
        if (res.ok) {
          setStatus("success")
          setMessage((data as { message?: string })?.message ?? "Email verificado correctamente")
        } else if (res.status === 400) {
          setStatus("expired")
          setMessage((data as { error?: string })?.error ?? "Token expirado")
        } else if (res.status === 404) {
          setStatus("notfound")
          setMessage((data as { error?: string })?.error ?? "Token no encontrado")
        } else {
          setStatus("error")
          setMessage((data as { error?: string })?.error ?? "Error al verificar")
        }
      } catch {
        if (!cancelled) {
          setStatus("error")
          setMessage("Error de red")
        }
      }
    }
    verify()
    return () => {
      cancelled = true
    }
  }, [token])

  async function onResend(e: React.FormEvent) {
    e.preventDefault()
    setResendMsg(null)
    if (!email) return
    setResendLoading(true)
    try {
      const res = await fetch("/api/auth/verify-email/resend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setResendMsg((data as { message?: string })?.message ?? "Si el email existe y no está verificado, se ha enviado un nuevo correo")
      } else {
        setResendMsg((data as { error?: string })?.error ?? "Error al reenviar")
      }
    } catch {
      setResendMsg("Error de red")
    } finally {
      setResendLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 py-12">
      <div className="w-full max-w-md rounded-xl border bg-white p-6 shadow-sm">
        {status === "pending" ? (
          <div role="status" className="text-center py-8">
            <div className="mx-auto mb-4 h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900" />
            <p className="text-sm text-zinc-600">Verificando...</p>
          </div>
        ) : null}

        {status === "success" ? (
          <div role="status" className="text-center">
            <div className="mb-4 rounded-md bg-green-50 px-4 py-3 text-sm text-green-700 border border-green-200">✓ {message}</div>
            <Link href="/login" className="text-sm font-medium text-zinc-900 underline">
              Ir a login
            </Link>
          </div>
        ) : null}

        {status === "expired" ? (
          <div role="alert" className="text-center">
            <div className="mb-4 rounded-md bg-yellow-50 px-4 py-3 text-sm text-yellow-800 border border-yellow-200">
              {message} — el enlace ha expirado.
            </div>
            <p className="mb-4 text-sm text-zinc-600">Solicita un nuevo enlace de verificación:</p>
          </div>
        ) : null}

        {status === "notfound" ? (
          <div role="alert" className="text-center">
            <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 border border-red-200">{message}</div>
          </div>
        ) : null}

        {status === "error" ? (
          <div role="alert" className="text-center">
            <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 border border-red-200">{message}</div>
          </div>
        ) : null}

        {status === "expired" || status === "notfound" || status === "error" ? (
          <form onSubmit={onResend} className="mt-4 space-y-3">
            <label htmlFor="resend-email" className="block text-sm font-medium">
              Email
            </label>
            <input
              id="resend-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={resendLoading}
              placeholder="tu@email.com"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-900 disabled:opacity-50"
            />
            <Button type="submit" disabled={resendLoading} className="w-full">
              {resendLoading ? "Enviando..." : "Reenviar verificación"}
            </Button>
            {resendMsg ? (
              <p role="status" className="text-center text-sm text-zinc-600">
                {resendMsg}
              </p>
            ) : null}
            <p className="text-center text-sm">
              <Link href="/login" className="font-medium text-zinc-900 underline">
                Volver a login
              </Link>
            </p>
          </form>
        ) : null}

        {status === "pending" ? (
          <p className="mt-6 text-center text-sm">
            <Link href="/login" className="text-zinc-600 underline">
              Volver a login
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  )
}
