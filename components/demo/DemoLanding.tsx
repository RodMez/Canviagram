'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { ArrowRight, CalendarDays, FolderKanban, Sparkles, Waypoints } from 'lucide-react'
import { useCanvasStore } from '@/store/canvas-store'
import { getDemoFixtures } from '@/lib/demo/fixtures'
import { Button } from '@/components/ui/button'
import Canvas from '@/components/canvas/Canvas'
import { RightPanel } from '@/components/canvas/RightPanel'

// ============================================================
// Demo Landing pública (F4.1, visual Fase V — energía alta)
//
// - Página ESTÁTICA: no importa DB, ni env, ni sesión. Todo el
//   estado del demo vive en el store (RAM).
// - Mount: demoMode ON + reseed de fixtures. Unmount: demoMode OFF
//   (crítico: sin el cleanup, un login posterior ignoraría sus SSE).
// - Refrescar = remount = reseed limpio (criterio F4.1, gratis).
// - Header propio (NO Toolbar: es workspace-bound y haría fetch 401).
// - Estructura hero → canvas demo → CTA final: la primera pantalla
//   vende el objetivo ("mira en qué estás trabajando").
// ============================================================

const VALUE_PROPS = [
  { icon: Waypoints, title: 'Planea en nodos', text: 'Proyectos, tareas y notas conectados en un canvas.' },
  { icon: Sparkles, title: 'La IA lo ordena', text: 'Crea y conecta por ti; el layout se arregla solo.' },
  { icon: CalendarDays, title: 'Hoy te enfoca', text: 'Cada mañana, lo urgente primero en tu vista Hoy.' },
]

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
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-secondary via-background to-background">
      {/* Header propio de landing */}
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-background/80 px-4 py-2 backdrop-blur safe-top sm:h-14 sm:flex-nowrap sm:gap-3 sm:py-0">
        <Link href="/" className="flex min-h-11 cursor-pointer items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shadow-sm">
            <FolderKanban className="h-4 w-4 text-primary-foreground" />
          </span>
          <span className="font-display text-xl font-semibold tracking-wide">Canviagram</span>
        </Link>
        <div className="hidden flex-1 sm:block" />
        {/* Base UI no soporta asChild (Radix); render={<Link/>} es el equivalente. */}
        <Button variant="ghost" className="h-11" render={<Link href="/login" />}>
          Iniciar sesión
        </Button>
        <Button className="h-11" render={<Link href="/register" />}>Crear cuenta</Button>
      </header>

      {/* Hero */}
      <section className="mx-auto w-full max-w-4xl px-6 pb-8 pt-10 text-center sm:pt-14">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-primary">
          Canvas visual + IA
        </p>
        <h1 className="mx-auto mt-3 max-w-2xl text-balance font-display text-4xl font-semibold leading-[0.95] tracking-tight sm:text-7xl">
          Mira en qué estás <span className="text-primary">trabajando</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-balance text-base text-muted-foreground sm:text-lg">
          Planea tus proyectos en nodos conectados, deja que la IA los ordene
          y despierta cada día sabiendo exactamente qué toca.
        </p>
        <div className="mt-6 flex flex-col flex-wrap items-center justify-center gap-3 sm:flex-row">
          <Button size="lg" className="h-12 w-full sm:w-auto" render={<Link href="/register" />}>
            Crear cuenta gratis
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button size="lg" variant="outline" className="h-12 w-full sm:w-auto" render={<a href="#demo" />}>
            Probar la demo
          </Button>
        </div>
        <ul className="mx-auto mt-8 grid max-w-3xl gap-3 text-left sm:grid-cols-3">
          {VALUE_PROPS.map((v) => (
            <li key={v.title} className="rounded-2xl border border-border bg-card p-4 shadow-sm transition-all motion-safe:hover:scale-[1.02] hover:shadow">
              <v.icon className="h-5 w-5 text-primary" />
              <p className="mt-2 text-sm font-bold">{v.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{v.text}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Canvas demo interactivo */}
      <section id="demo" className="mx-auto w-full max-w-6xl scroll-mt-16 px-4 sm:px-6">
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
          <div className="flex items-center gap-2 border-b border-border bg-muted/60 px-4 py-2">
            <span className="h-2.5 w-2.5 rounded-full bg-primary/70" aria-hidden />
            <span className="h-2.5 w-2.5 rounded-full bg-accent/70" aria-hidden />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" aria-hidden />
            <span className="ml-2 text-xs font-medium text-muted-foreground">
              Demo interactiva — crea nodos, conéctalos, pregúntale a la IA. Nada se guarda.
            </span>
          </div>
          <div className="flex h-[62dvh] min-h-[420px] overflow-hidden">
            <Canvas workspaceId="demo" userId="demo" />
            <RightPanel workspaceId="demo" userId="demo" />
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="mx-auto w-full max-w-4xl px-6 py-12 text-center">
        <div className="rounded-2xl bg-primary px-6 py-10 text-primary-foreground shadow-lg">
          <h2 className="mx-auto max-w-xl text-balance font-display text-3xl font-semibold leading-tight sm:text-4xl">
            Tu primer proyecto, ordenado en 2 minutos
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-primary-foreground/80">
            Crea tu cuenta y convierte esta demo en tu workspace real, con
            recordatorios y tu vista Hoy.
          </p>
          <Button
            size="lg"
            variant="outline"
            className="mt-6 h-12 w-full border-primary-foreground/40 bg-primary-foreground text-primary hover:bg-primary-foreground/90 hover:text-primary sm:w-auto"
            render={<Link href="/register" />}
          >
            Crear cuenta gratis
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </section>
    </div>
  )
}
