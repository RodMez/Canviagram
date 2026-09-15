'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
  ArrowRight,
  CalendarDays,
  Check,
  Flame,
  FolderKanban,
  Send,
  Sparkles,
  Table,
  Waypoints,
} from 'lucide-react'
import { useCanvasStore } from '@/store/canvas-store'
import { useBoardStore } from '@/store/board-store'
import {
  DEMO_SUGGESTED_PROMPTS,
  DEMO_WORKSPACE_NAME,
  getDemoBoardColumns,
  getDemoFixtures,
} from '@/lib/demo/fixtures'
import { Button } from '@/components/ui/button'
import Canvas from '@/components/canvas/Canvas'
import { RightPanel } from '@/components/canvas/RightPanel'
import { Board } from '@/components/board/Board'
import { DemoTodayPreview } from '@/components/demo/DemoTodayPreview'

// ============================================================
// Demo Landing pública (F7 — rediseño evolutivo, Café Luna)
//
// - Página ESTÁTICA: no importa DB, ni env, ni sesión. Todo el
//   estado del demo vive en los stores (RAM).
// - Mount: demoMode ON + reseed de fixtures + columnas demo.
//   Unmount: demoMode OFF + restaura la preferencia de colapso
//   del panel (crítico: sin el cleanup, un login posterior
//   ignoraría sus SSE; y sin aislar el flag, cerrar el chat en
//   móvil lo hacía desaparecer para siempre).
// - Refrescar = remount = reseed limpio (gratis).
// - Header propio (NO Toolbar: es workspace-bound y haría fetch).
// - Demo con tabs Tablero | Canvas | Hoy: en móvil arranca en
//   Tablero (el Canvas libre no se lee bien en 375px); el chat IA
//   es bottom-sheet con FAB de reapertura.
// ============================================================

type DemoTab = 'board' | 'canvas' | 'today'

const TABS: { id: DemoTab; label: string }[] = [
  { id: 'board', label: 'Tablero' },
  { id: 'canvas', label: 'Canvas' },
  { id: 'today', label: 'Hoy' },
]

const HOW_IT_WORKS = [
  {
    step: '1',
    title: 'Planea como piensas',
    text: 'Tareas en el Tablero, conexiones en el Canvas, detalle en la Tabla. Emma, Liam y Oliver ven lo mismo.',
  },
  {
    step: '2',
    title: 'Pide por chat o Telegram',
    text: '“¿Qué vence hoy?” o “mueve la máquina a En progreso”. La IA crea, conecta y ordena por ti.',
  },
  {
    step: '3',
    title: 'Enfócate en Hoy',
    text: 'Cada mañana, primero lo vencido, luego lo de hoy. Marcar hecha cuesta un toque.',
  },
]

const WHATS_NEW = [
  { icon: FolderKanban, title: 'Tablero kanban', text: 'Arrastra entre columnas con responsable, prioridad y esfuerzo. Aviso “Bloqueada por” incluido.' },
  { icon: Table, title: 'Vista Tabla', text: 'Tus tareas en filas: ordena, filtra y edita sin abrir el canvas.' },
  { icon: CalendarDays, title: 'Vista Hoy', text: 'Vencidas, hoy y próximas en un bento. Es la pantalla al entrar.' },
  { icon: Send, title: 'Telegram de verdad', text: 'Vincula tu cuenta, cambia de café con /usar y crea tareas desde el sofá.' },
  { icon: Sparkles, title: 'IA que actúa', text: 'Crea y renombra workspaces con tu voz, te resume qué hizo y pide confirmación antes de borrar.' },
  { icon: Waypoints, title: 'Canvas conectado', text: 'Los porqués a la vista: sin permiso no hay máquina ni fiesta. Layout que se ordena solo.' },
]

const STORY_STEPS = [
  {
    title: 'Todo en el Tablero',
    text: 'La máquina espera al permiso: mira el chip “Bloqueada por”. Arrastra una tarjeta y cambia su estado.',
    cta: 'Abrir Tablero',
    tab: 'board' as DemoTab,
    prompt: null as string | null,
  },
  {
    title: 'Pregúntale a la IA',
    text: 'El chat conoce el café: fechas, prioridades y bloqueos. Pruébalo sin cuenta.',
    cta: '¿Qué me falta para abrir?',
    tab: 'board' as DemoTab,
    prompt: '¿Qué me falta para abrir Café Luna?',
  },
  {
    title: 'Mira tu Hoy',
    text: 'El permiso venció ayer: sale primero. La máquina y el menú tocan hoy.',
    cta: 'Abrir Hoy',
    tab: 'today' as DemoTab,
    prompt: null as string | null,
  },
  {
    title: 'Entiende el porqué',
    text: 'En el Canvas se ve la cadena: permiso → máquina → menú → fiesta. Borra o conecta sin miedo, nada se guarda.',
    cta: 'Abrir Canvas',
    tab: 'canvas' as DemoTab,
    prompt: null as string | null,
  },
]

export default function DemoLanding() {
  const [tab, setTab] = useState<DemoTab>(() =>
    typeof window !== 'undefined' && window.innerWidth < 640 ? 'board' : 'canvas'
  )
  const isPanelCollapsed = useCanvasStore((s) => s.isPanelCollapsed)

  useEffect(() => {
    const store = useCanvasStore.getState()
    // F1 (chat fantasma en móvil): la preferencia global de colapso vive en
    // localStorage; la demo la aparta al montar y la restaura al salir para
    // no pisar la app real. El panel siempre arranca abierto aquí.
    try {
      const prev = localStorage.getItem('canviagram:panel-collapsed')
      sessionStorage.setItem('canviagram:landing-prev-collapsed', prev ?? '')
      localStorage.removeItem('canviagram:panel-collapsed')
    } catch {
      // almacenamiento no disponible: la demo sigue en memoria
    }
    store.setDemoMode(true)
    const { nodes, edges } = getDemoFixtures()
    store.loadGraph(nodes, edges)
    useBoardStore.getState().loadColumns('demo', getDemoBoardColumns())
    if (store.isPanelCollapsed) store.togglePanel()
    store.setPanelTab('ai')
    return () => {
      useCanvasStore.getState().setDemoMode(false)
      try {
        const prev = sessionStorage.getItem('canviagram:landing-prev-collapsed')
        if (prev) localStorage.setItem('canviagram:panel-collapsed', prev)
        else localStorage.removeItem('canviagram:panel-collapsed')
      } catch {
        // sin-op
      }
    }
  }, [])

  const runPrompt = (prompt: string, nextTab: DemoTab = tab) => {
    setTab(nextTab)
    const store = useCanvasStore.getState()
    if (store.isPanelCollapsed) store.togglePanel()
    store.setPanelTab('ai')
    window.dispatchEvent(new CustomEvent('canviagram:demo-prompt', { detail: prompt }))
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-secondary via-background to-background">
      {/* Header propio de landing con marca real */}
      <header className="sticky top-0 z-30 flex min-h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 py-2 backdrop-blur safe-top">
        <Link href="/" className="flex min-h-11 cursor-pointer items-center gap-2" aria-label="Canviagram inicio">
          <Image
            src="/brand/logo-horizontal-256.webp"
            alt="Canviagram"
            width={143}
            height={43}
            className="hidden h-8 w-auto sm:block"
            priority
          />
          <Image
            src="/brand/isotipo-32.png"
            alt="Canviagram"
            width={32}
            height={32}
            className="h-8 w-8 sm:hidden"
            priority
          />
          <span className="font-display text-xl font-semibold tracking-wide sm:hidden">Canviagram</span>
        </Link>
        <div className="flex-1" />
        {/* Base UI no soporta asChild (Radix); render={<Link/>} es el equivalente. */}
        <Button variant="ghost" className="h-11" render={<Link href="/login" />}>
          Iniciar sesión
        </Button>
        <Button className="h-11" render={<Link href="/register" />}>Crear cuenta</Button>
      </header>

      {/* Hero */}
      <section className="mx-auto w-full max-w-4xl px-6 pb-8 pt-10 text-center sm:pt-14">
        <p className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-bold text-primary shadow-sm">
          <Flame className="h-3.5 w-3.5" />
          Nuevo: Tablero · Tabla · Hoy · Telegram
        </p>
        <h1 className="mx-auto mt-4 max-w-2xl text-balance font-display text-5xl font-semibold leading-[0.95] tracking-tight sm:text-7xl">
          Abre tu café <span className="text-primary">sin caos</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-balance text-base text-muted-foreground sm:text-lg">
          {DEMO_WORKSPACE_NAME} se planea en Tablero y Canvas, le preguntas a la
          IA o a Telegram, y cada mañana tu vista Hoy te dice por dónde empezar.
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
        <Image
          src="/brand/logo-desc-debajo-horizontal.png"
          alt="Canviagram — Canvas + IA para gestionar tu día"
          width={717}
          height={215}
          className="mx-auto mt-8 h-auto w-full max-w-md"
          loading="lazy"
        />
        <p className="mt-3 text-xs text-muted-foreground">
          Emma, Liam y Oliver ya abren {DEMO_WORKSPACE_NAME} · Demo viva, sin cuenta
        </p>
      </section>

      {/* Demo interactiva con tabs */}
      <section id="demo" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 sm:px-6">
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/60 px-3 py-2 sm:px-4">
            <div role="tablist" aria-label="Vistas de la demo" className="flex gap-1 rounded-xl bg-background p-1 shadow-sm">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={`h-11 cursor-pointer rounded-lg px-3 text-sm font-semibold transition-colors sm:h-9 ${
                    tab === t.id ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <span className="hidden text-xs font-medium text-muted-foreground lg:inline">
              Demo interactiva de {DEMO_WORKSPACE_NAME} — nada se guarda.
            </span>
          </div>
          <div className="flex gap-1.5 overflow-x-auto border-b border-border bg-background px-3 py-2">
            {DEMO_SUGGESTED_PROMPTS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => runPrompt(p.prompt)}
                className="h-11 shrink-0 cursor-pointer rounded-full border border-border bg-card px-3 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:text-primary sm:h-8"
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex h-[68dvh] min-h-[480px] overflow-hidden sm:h-[72dvh]">
            <div className="relative min-w-0 flex-1">
              {tab === 'board' && (
                <div className="absolute inset-0 flex">
                  <Board workspaceId="demo" onSwitchToCanvas={() => setTab('canvas')} />
                </div>
              )}
              {tab === 'canvas' && (
                <div className="demo-canvas absolute inset-0">
                  <Canvas workspaceId="demo" userId="demo" />
                </div>
              )}
              {tab === 'today' && (
                <div className="absolute inset-0">
                  <DemoTodayPreview />
                </div>
              )}
            </div>
            <RightPanel workspaceId="demo" userId="demo" />
          </div>
        </div>
      </section>

      {/* FAB de reapertura del chat (fix F1: el chat nunca desaparece) */}
      {isPanelCollapsed && (
        <button
          type="button"
          onClick={() => {
            const store = useCanvasStore.getState()
            store.togglePanel()
            store.setPanelTab('ai')
          }}
          aria-label="Abrir chat IA"
          className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-4 z-50 flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-primary shadow-2xl transition-transform active:scale-95"
        >
          <Image src="/brand/isotipo-32.png" alt="" width={32} height={32} className="h-8 w-8" />
        </button>
      )}

      {/* Cómo funciona */}
      <section className="mx-auto w-full max-w-5xl px-6 pt-14">
        <h2 className="text-center font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Así se abre un café
        </h2>
        <ol className="mt-6 grid gap-3 sm:grid-cols-3">
          {HOW_IT_WORKS.map((s) => (
            <li key={s.step} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                {s.step}
              </span>
              <p className="mt-3 text-sm font-bold">{s.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Todo lo nuevo */}
      <section className="mx-auto w-full max-w-5xl px-6 pt-14">
        <p className="text-center text-xs font-bold uppercase tracking-[0.25em] text-primary">
          Desde la última versión
        </p>
        <h2 className="mx-auto mt-2 max-w-xl text-center text-balance font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Todo lo que cambió, en una pantalla
        </h2>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {WHATS_NEW.map((v) => (
            <li key={v.title} className="rounded-2xl border border-border bg-card p-5 shadow-sm transition-all motion-safe:hover:scale-[1.02] hover:shadow">
              <v.icon className="h-5 w-5 text-primary" />
              <p className="mt-2 text-sm font-bold">{v.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{v.text}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Historia guiada */}
      <section className="mx-auto w-full max-w-5xl px-6 pt-14">
        <h2 className="text-center font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          La historia de {DEMO_WORKSPACE_NAME}
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-sm text-muted-foreground">
          El permiso venció ayer y bloquea la máquina y la fiesta. Recorre la
          historia paso a paso en la demo de arriba.
        </p>
        <ol className="mt-6 grid gap-3 sm:grid-cols-2">
          {STORY_STEPS.map((s, i) => (
            <li key={s.title} className="flex flex-col rounded-2xl border border-border bg-card p-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Paso {i + 1}</p>
              <p className="mt-1 text-sm font-bold">{s.title}</p>
              <p className="mt-1 flex-1 text-xs leading-relaxed text-muted-foreground">{s.text}</p>
              <Button
                variant="outline"
                className="mt-4 h-11 self-start"
                onClick={() => (s.prompt ? runPrompt(s.prompt, s.tab) : setTab(s.tab))}
              >
                {s.cta}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ol>
      </section>

      {/* CTA final */}
      <section className="mx-auto w-full max-w-4xl px-6 py-14 text-center">
        <div className="rounded-3xl bg-primary px-6 py-12 text-primary-foreground shadow-lg">
          <p className="mx-auto flex max-w-md items-center justify-center gap-2 text-sm font-semibold text-primary-foreground/90">
            <Check className="h-4 w-4" />
            Tu café, tu mudanza, tu semestre: ordenado en 2 minutos
          </p>
          <h2 className="mx-auto mt-2 max-w-xl text-balance font-display text-3xl font-semibold leading-tight sm:text-5xl">
            Convierte esta demo en tu proyecto real
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-primary-foreground/80">
            Crea tu cuenta y sigue con Tablero, Hoy, recordatorios y Telegram
            vinculados a tu cuenta.
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

      {/* Footer */}
      <footer className="border-t border-border bg-card safe-bottom">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-4 px-6 py-8 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2">
            <Image src="/brand/logo-cuadrado-256.webp" alt="Canviagram" width={81} height={54} className="h-9 w-auto" loading="lazy" />
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Canvas + IA para gestionar tu día · Tablero, Hoy y Telegram
          </p>
          <nav className="flex items-center gap-1 text-sm" aria-label=" pie de página">
            <Button variant="ghost" className="h-11" render={<Link href="/login" />}>
              Iniciar sesión
            </Button>
            <Button variant="ghost" className="h-11" render={<Link href="/register" />}>
              Crear cuenta
            </Button>
          </nav>
        </div>
      </footer>
    </div>
  )
}
