import Link from "next/link"
import type { ReactNode } from "react"

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 py-12">
      <Link href="/" className="mb-8 text-xl font-bold tracking-tight">
        Canviagram
      </Link>
      <div className="w-full max-w-md rounded-xl border bg-white p-6 shadow-sm">{children}</div>
      <p className="mt-6 text-xs text-zinc-500">© Canviagram</p>
    </div>
  )
}
