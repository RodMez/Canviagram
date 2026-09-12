"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { registerSchema } from "@/lib/validators/auth"
import { Button } from "@/components/ui/button"

export default function RegisterPage() {
  const router = useRouter()
  const [form, setForm] = useState({ email: "", password: "", displayName: "" })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [rootError, setRootError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showBanner, setShowBanner] = useState(false)

  useEffect(() => {
    if (!showBanner) return
    // F5.4: el landing post-registro es Hoy (el estado vacío guía a workspaces).
    const t = setTimeout(() => {
      router.push("/today")
    }, 800)
    return () => clearTimeout(t)
  }, [showBanner, router])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setRootError(null)
    setFieldErrors({})
    const parsed = registerSchema.safeParse(form)
    if (!parsed.success) {
      setFieldErrors(parsed.error.flatten().fieldErrors as Record<string, string[]>)
      return
    }
    setIsSubmitting(true)
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 201) {
        setShowBanner(true)
        return
      }
      if (res.status === 409) {
        setRootError((data as { error?: string })?.error ?? "El email ya está registrado")
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
      setRootError((data as { error?: string })?.error ?? "Error al crear cuenta")
    } catch {
      setRootError("Error de red")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Crea tu cuenta</h1>

      {showBanner ? (
        <div role="alert" className="mb-4 rounded-md bg-green-50 px-4 py-3 text-sm text-green-700 border border-green-200">
          ✓ Cuenta creada. Revisa tu email para verificar tu cuenta.
        </div>
      ) : null}

      {rootError ? (
        <div role="alert" className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 border border-red-200">
          {rootError}
        </div>
      ) : null}

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor="displayName" className="mb-1 block text-sm font-medium">
            Nombre
          </label>
          <input
            id="displayName"
            type="text"
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            disabled={isSubmitting}
            aria-invalid={Boolean(fieldErrors.displayName)}
            autoComplete="name"
            className="h-11 w-full rounded-lg border border-border bg-background px-3 text-base outline-none transition-shadow focus:ring-2 focus:ring-ring disabled:opacity-50 sm:text-sm"
            placeholder="Tu nombre"
          />
          {fieldErrors.displayName?.[0] ? (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.displayName[0]}</p>
          ) : null}
        </div>

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
            autoComplete="email"
            inputMode="email"
            className="h-11 w-full rounded-lg border border-border bg-background px-3 text-base outline-none transition-shadow focus:ring-2 focus:ring-ring disabled:opacity-50 sm:text-sm"
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
            autoComplete="new-password"
            className="h-11 w-full rounded-lg border border-border bg-background px-3 text-base outline-none transition-shadow focus:ring-2 focus:ring-ring disabled:opacity-50 sm:text-sm"
            placeholder="Mínimo 8 caracteres"
          />
          {fieldErrors.password?.[0] ? (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.password[0]}</p>
          ) : null}
        </div>

        <Button type="submit" disabled={isSubmitting} className="h-11 w-full cursor-pointer text-base sm:text-sm">
          {isSubmitting ? "Creando..." : "Crear cuenta"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-zinc-600">
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="font-medium text-zinc-900 underline">
          Inicia sesión
        </Link>
      </p>
    </div>
  )
}
