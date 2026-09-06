'use client'

import type { ReactNode } from 'react'

// Shell del área autenticada (app). Genérico y reutilizable para futuras rutas (app).
// No duplica lógica de sesión ni el auth layout; cada page.tsx valida acceso.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {children}
    </div>
  )
}