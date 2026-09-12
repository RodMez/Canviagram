"use client"

import { useState } from "react"
import Link from "next/link"
import { requestPasswordResetSchema } from "@/lib/validators/auth"
import { Button } from "@/components/ui/button"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setMessage(null)
    setIsError(false)
    setFieldErrors({})
    const parsed = requestPasswordResetSchema.safeParse({ email })
    if (!parsed.success) {
      setFieldErrors(parsed.error.flatten().fieldErrors as Record<string, string[]>)
      return
    }
    setIsSubmitting(true)
    try {
      const res = await fetch("/api/auth/password/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setMessage(
          (data as { message?: string })?.message ??
            "Si el email existe, se ha enviado un enlace de recuperación"
        )
        return
      }
      if (res.status === 400) {
        const details = (data as { details?: { fieldErrors?: Record<string, string[]> } })?.details
        if (details?.fieldErrors) {
          setFieldErrors(details.fieldErrors)
        } else {
          setMessage((data as { error?: string })?.error ?? "Datos inválidos")
          setIsError(true)
        }
        return
      }
      setMessage((data as { error?: string })?.error ?? "Error al enviar el enlace")
      setIsError(true)
    } catch {
      setMessage("Error de red")
      setIsError(true)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Recupera tu contraseña</h1>

      {message ? (
        <div
          role={isError ? "alert" : "status"}
          className={`mb-4 rounded-md border px-4 py-3 text-sm ${
            isError
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-green-200 bg-green-50 text-green-700"
          }`}
        >
          {message}
        </div>
      ) : null}

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isSubmitting}
            aria-invalid={Boolean(fieldErrors.email)}
            autoComplete="email"
            inputMode="email"
            className="h-11 w-full rounded-lg border border-border bg-background px-3 text-base outline-none transition-shadow focus:ring-2 focus:ring-ring disabled:opacity-50 sm:text-sm"
            placeholder="tu@email.com"
          />
          {fieldErrors.email?.[0] ? (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.email[0]}</p>
          ) : null}
        </div>

        <Button type="submit" disabled={isSubmitting} className="h-11 w-full cursor-pointer text-base sm:text-sm">
          {isSubmitting ? "Enviando..." : "Enviar enlace de recuperación"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-zinc-600">
        ¿Recordaste tu contraseña?{" "}
        <Link href="/login" className="font-medium text-zinc-900 underline">
          Inicia sesión
        </Link>
      </p>
    </div>
  )
}