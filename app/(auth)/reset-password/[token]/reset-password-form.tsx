"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { resetPasswordSchema } from "@/lib/validators/auth"
import { Button } from "@/components/ui/button"

export default function ResetPasswordForm({ initialToken }: { initialToken: string }) {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [rootError, setRootError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setRootError(null)
    setFieldErrors({})
    if (password !== confirm) {
      setFieldErrors({ confirm: ["Las contraseñas no coinciden"] })
      return
    }
    const parsed = resetPasswordSchema.safeParse({ token: initialToken, password })
    if (!parsed.success) {
      setFieldErrors(parsed.error.flatten().fieldErrors as Record<string, string[]>)
      return
    }
    setIsSubmitting(true)
    try {
      const res = await fetch("/api/auth/password/reset/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: initialToken, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        router.push("/login?reset=1")
        return
      }
      if (res.status === 400) {
        const details = (data as { details?: { fieldErrors?: Record<string, string[]> } })?.details
        if (details?.fieldErrors) {
          setFieldErrors(details.fieldErrors)
        } else {
          setRootError((data as { error?: string })?.error ?? "Token no válido o expirado")
        }
        return
      }
      setRootError((data as { error?: string })?.error ?? "Error al actualizar la contraseña")
    } catch {
      setRootError("Error de red")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Nueva contraseña</h1>

      {rootError ? (
        <div role="alert" className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 border border-red-200">
          {rootError}
        </div>
      ) : null}

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium">
            Nueva contraseña
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isSubmitting}
            aria-invalid={Boolean(fieldErrors.password)}
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-900 disabled:opacity-50"
            placeholder="Mínimo 8 caracteres"
          />
          {fieldErrors.password?.[0] ? (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.password[0]}</p>
          ) : null}
        </div>

        <div>
          <label htmlFor="confirm" className="mb-1 block text-sm font-medium">
            Confirmar contraseña
          </label>
          <input
            id="confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={isSubmitting}
            aria-invalid={Boolean(fieldErrors.confirm)}
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-900 disabled:opacity-50"
            placeholder="Repite la contraseña"
          />
          {fieldErrors.confirm?.[0] ? (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.confirm[0]}</p>
          ) : null}
        </div>

        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? "Actualizando..." : "Actualizar contraseña"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-zinc-600">
        <Link href="/login" className="font-medium text-zinc-900 underline">
          Volver a login
        </Link>
      </p>
    </div>
  )
}