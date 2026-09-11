"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { loginSchema } from "@/lib/validators/auth"
import { Button } from "@/components/ui/button"

function sanitizeNext(value: string | null): string | null {
  if (!value) return null
  if (!value.startsWith("/")) return null
  if (value.startsWith("//")) return null
  if (value.startsWith("/login")) return null
  if (value.startsWith("/register")) return null
  if (value.includes("\\")) return null
  return value
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextParam = sanitizeNext(searchParams.get("next"))
  const resetParam = searchParams.get("reset") === "1"

  const [form, setForm] = useState({ email: "", password: "" })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [rootError, setRootError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setRootError(null)
    setFieldErrors({})
    const parsed = loginSchema.safeParse(form)
    if (!parsed.success) {
      setFieldErrors(parsed.error.flatten().fieldErrors as Record<string, string[]>)
      return
    }
    setIsSubmitting(true)
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        if (nextParam) {
          router.push(nextParam)
          return
        }
        // F5.4: el landing post-login es Hoy, no un canvas ni /workspaces.
        router.push("/today")
        return
      }
      if (res.status === 401) {
        setRootError("Credenciales inválidas")
        return
      }
      if (res.status === 400) {
        const details = (data as { details?: { fieldErrors?: Record<string, string[]> } })?.details
        if (details?.fieldErrors) {
          setFieldErrors(details.fieldErrors)
        } else {
          setRootError((data as { error?: string })?.error ?? "Datos inválidos")
        }
        return
      }
      setRootError((data as { error?: string })?.error ?? "Error al iniciar sesión")
    } catch {
      setRootError("Error de red")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Inicia sesión</h1>

      {resetParam ? (
        <div role="status" className="mb-4 rounded-md bg-green-50 px-4 py-3 text-sm text-green-700 border border-green-200">
          Contraseña actualizada. Inicia sesión con tu nueva contraseña.
        </div>
      ) : null}

      {rootError ? (
        <div role="alert" className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 border border-red-200">
          {rootError}
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
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            disabled={isSubmitting}
            aria-invalid={Boolean(fieldErrors.email)}
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-900 disabled:opacity-50"
            placeholder="tu@email.com"
          />
          {fieldErrors.email?.[0] ? (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.email[0]}</p>
          ) : null}
        </div>

        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium">
            Contraseña
          </label>
          <input
            id="password"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            disabled={isSubmitting}
            aria-invalid={Boolean(fieldErrors.password)}
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-900 disabled:opacity-50"
            placeholder="Tu contraseña"
          />
          {fieldErrors.password?.[0] ? (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.password[0]}</p>
          ) : null}
        </div>

        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? "Entrando..." : "Entrar"}
        </Button>
      </form>

      <div className="mt-4 text-center">
        <Link href="/forgot-password" className="text-sm text-zinc-600 underline">
          ¿Olvidaste tu contraseña?
        </Link>
      </div>

      <p className="mt-6 text-center text-sm text-zinc-600">
        ¿No tienes cuenta?{" "}
        <Link href="/register" className="font-medium text-zinc-900 underline">
          Crea una
        </Link>
      </p>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="text-sm text-zinc-500">Cargando...</div>}>
      <LoginForm />
    </Suspense>
  )
}
