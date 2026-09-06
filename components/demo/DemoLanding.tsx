'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { FolderKanban } from 'lucide-react'
import { useCanvasStore } from '@/store/canvas-store'
import { getDemoFixtures } from '@/lib/demo/fixtures'
import { Button } from '@/components/ui/button'
import Canvas from '@/components/canvas/Canvas'
import { RightPanel } from '@/components/canvas/RightPanel'

// ============================================================
// Demo Landing pública (F4.1) — reemplaza el boilerplate de `/`.
//
// - Página ESTÁTICA: no importa DB, ni env, ni sesión. Todo el
//   estado del demo vive en el store (RAM).
// - Mount: demoMode ON + reseed de fixtures. Unmount: demoMode OFF
//   (crítico: sin el cleanup, un login posterior ignoraría sus SSE).
// - Refrescar = remount = reseed limpio (criterio F4.1, gratis).
// - Header propio (NO Toolbar: es workspace-bound y haría fetch 401).
// - Sin TokenPicker, sin settings, sin Toolbar.
// ============================================================

export default function DemoLanding() {
  useEffect(() => {
    const store = useCanvasStore.getState()
    store.setDemoMode(true)
    const { nodes, edges } = getDemoFixtures()
    store.loadGraph(nodes, edges)
    return () => {
      useCanvasStore.getState().setDemoMode(false)
    }
  }, [])

  return (
    <div className="flex h-screen flex-col">
      {/* Header propio de landing (identidad visual = Toolbar) */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
          <FolderKanban className="h-5 w-5 text-primary" />
          <span>Canviagram</span>
        </Link>
        <div className="flex-1" />
        {/* Base UI no soporta asChild (Radix); render={<Link/>} es el equivalente. */}
        <Button variant="ghost" render={<Link href="/login" />}>
          Iniciar sesión
        </Button>
        <Button render={<Link href="/register" />}>Crear cuenta</Button>
      </header>

      {/* pb-12: espacio para el banner fijo (no tapa los Controls de ReactFlow) */}
      <div className="flex flex-1 overflow-hidden pb-12">
        <Canvas workspaceId="demo" userId="demo" />
        <RightPanel workspaceId="demo" userId="demo" />
      </div>

      {/* Banner fijo de registro */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-center gap-3 border-t border-border bg-background/80 px-4 py-2 text-sm backdrop-blur">
        <span>Crea una cuenta para guardar tu trabajo</span>
        <Button size="sm" render={<Link href="/register" />}>
          Crear cuenta
        </Button>
      </div>
    </div>
  )
}