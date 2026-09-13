import Link from "next/link"
import type { ReactNode } from "react"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth/session"

export default async function AuthLayout({ children }: { children: ReactNode }) {
  // Si ya está logueado, /login y /register redirigen a la página del usuario.
  const session = await getSession()
  if (session) {
    redirect("/today")
  }
  return (
    <div className="flex min-h-dvh flex-col items-center justify-start bg-background px-4 pb-8 pt-8 safe-top safe-bottom sm:justify-center sm:py-12">
      <Link href="/" className="mb-6 font-display text-2xl font-semibold tracking-tight text-foreground sm:mb-8">
        Canviagram
      </Link>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-lg sm:p-6">
        {children}
      </div>
      <p className="mt-6 text-xs text-muted-foreground">© Canviagram</p>
    </div>
  )
}
