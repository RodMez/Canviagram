import type { Node, Edge } from '@/lib/db/schema'
import { serializeNode, serializeEdge } from '@/lib/ai/serialize'

// ============================================================
// Fixtures de la DEMO pública (F7: historia "Café Luna")
//
// Escena de 12 nodos / 7 edges con shape EXACTO de DB
// (Node/Edge de lib/db/schema.ts) para reutilizar rf.ts y
// storeToRfNodes/Edges sin cambios. Cada llamada a
// getDemoFixtures() devuelve arrays NUEVOS (reseed limpio en
// cada mount de DemoLanding). Nada de esto toca DB ni sesión.
// F5.1: sin nodo-hub `project` (un workspace = un proyecto);
// la descripción del proyecto vive en el workspace ("Café Luna").
//
// Historia: tres personas abren un café de barrio. Cotidiana y
// general (nada ingenieril): ejercita Tablero (status), Tabla
// (prioridad), Hoy (dueDate), Canvas (depends_on/related_to),
// Telegram e IA con una sola narrativa coherente.
// Personas con nombres ingleses amigables con el español.
// ============================================================

export const DEMO_WORKSPACE_ID = 'demo'
export const DEMO_WORKSPACE_NAME = 'Café Luna'
export const DEMO_WORKSPACE_SLUG = 'cafe-luna'

export const DEMO_CREATED_AT = new Date('2026-09-01T12:00:00.000Z')

export function isDemoWorkspace(id: string): boolean {
  return id === DEMO_WORKSPACE_ID
}

/** Personas de la historia (nombres ingleses, amigables en español). */
export const DEMO_PEOPLE = [
  { id: 'demo-person-emma', name: 'Emma', role: 'repostería y menú' },
  { id: 'demo-person-liam', name: 'Liam', role: 'local y obra' },
  { id: 'demo-person-oliver', name: 'Oliver', role: 'personal y fiesta' },
] as const

export type DemoPersonName = (typeof DEMO_PEOPLE)[number]['name']

const DEMO_PERSON_NAMES = DEMO_PEOPLE.map((p) => p.name)

/**
 * En la demo no hay usuarios reales: el `assigneeId` de los fixtures es el
 * nombre de la persona (Emma/Liam/Oliver). Este helper lo resuelve a nombre
 * visible; fuera de la demo o con otro valor devuelve null.
 */
export function resolveDemoAssigneeName(assigneeId: string | null | undefined): DemoPersonName | null {
  if (!assigneeId) return null
  return (DEMO_PERSON_NAMES as string[]).includes(assigneeId) ? (assigneeId as DemoPersonName) : null
}

/** Responsable de cada tarea (demo-only: no hay usuarios reales). */
export const DEMO_ASSIGNEES: Record<string, DemoPersonName> = {
  'demo-task-local': 'Liam',
  'demo-task-permiso': 'Emma',
  'demo-task-maquina': 'Liam',
  'demo-task-menu': 'Emma',
  'demo-task-pintar': 'Liam',
  'demo-task-barista': 'Oliver',
  'demo-task-fiesta': 'Oliver',
}

/** Prompts sugeridos clicables en la demo (llenan el input del chat IA). */
export const DEMO_SUGGESTED_PROMPTS = [
  { id: 'hoy', label: '¿Qué vence hoy?', prompt: '¿Qué vence hoy en Café Luna?' },
  { id: 'falta', label: '¿Qué me falta para abrir?', prompt: '¿Qué me falta para abrir Café Luna?' },
  { id: 'mover', label: 'Mueve la máquina a En progreso', prompt: 'Mueve "Comprar máquina espresso" a En progreso' },
  { id: 'crear', label: 'Crea: comprar hielo', prompt: 'Crea la tarea "Comprar hielo para la fiesta" para este viernes' },
] as const

// Ids efímeros para nodos/edges creados en la demo: `n-<8hex>` / `e-<8hex>`.
// Fallback a contador si crypto.randomUUID no está disponible.
let demoIdCounter = 0
export function demoId(prefix: 'n' | 'e'): string {
  const hasCrypto =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  const suffix = hasCrypto
    ? crypto.randomUUID().slice(0, 8)
    : (++demoIdCounter).toString(16).padStart(8, '0')
  return `${prefix}-${suffix}`
}

function makeNode(
  overrides: Partial<Node> &
    Pick<Node, 'id' | 'type' | 'title' | 'positionX' | 'positionY'>
): Node {
  return {
    workspaceId: DEMO_WORKSPACE_ID,
    createdBy: 'demo',
    content: null,
    status: null,
    priority: null,
    effort: null,
    assigneeId: null,
    linkedUserId: null,
    boardColumnId: null,
    boardOrder: 0,
    dueDate: null,
    reminderOffsetMin: null,
    notifiedAt: null,
    recurrenceRule: null,
    createdAt: DEMO_CREATED_AT,
    updatedAt: DEMO_CREATED_AT,
    deletedAt: null,
    ...overrides,
  }
}

function makeEdge(
  overrides: Partial<Edge> & Pick<Edge, 'id' | 'sourceId' | 'targetId' | 'type'>
): Edge {
  return {
    workspaceId: DEMO_WORKSPACE_ID,
    createdBy: 'demo',
    label: null,
    createdAt: DEMO_CREATED_AT,
    ...overrides,
  }
}

/** Fecha relativa a `base`: `days` desde hoy a las `hour:minute` locales. */
function daysFromNow(base: Date, days: number, hour = 12, minute = 0): Date {
  const d = new Date(base)
  d.setHours(hour, minute, 0, 0)
  d.setDate(d.getDate() + days)
  return d
}

/**
 * Escena demo Café Luna (12 nodos / 7 edges).
 * `now` fija el "hoy" de la historia: los dueDate son relativos para que
 * los buckets de Hoy (vencida/hoy/próxima) siempre funcionen.
 * Arrays NUEVOS en cada llamada: refrescar = remount = reseed limpio.
 */
export function getDemoFixtures(now: Date = new Date()): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    makeNode({
      id: 'demo-task-local',
      type: 'task',
      title: 'Elegir local en la plaza',
      content: 'Responsable: Liam. Local de 60 m² con terraza, contrato firmado.',
      status: 'done',
      priority: 'medium',
      effort: 30,
      assigneeId: 'Liam',
      boardColumnId: 'demo-col-done',
      boardOrder: 1000,
      dueDate: daysFromNow(now, -6, 12),
      positionX: -320,
      positionY: 80,
    }),
    makeNode({
      id: 'demo-task-permiso',
      type: 'task',
      title: 'Tramitar permiso sanitario',
      content: 'Responsable: Emma. Llevar plano del local y carnet de manipulación.',
      status: 'todo',
      priority: 'high',
      effort: 20,
      assigneeId: 'Emma',
      boardColumnId: 'demo-col-todo',
      boardOrder: 1000,
      dueDate: daysFromNow(now, -1, 12),
      positionX: -110,
      positionY: 80,
    }),
    makeNode({
      id: 'demo-task-maquina',
      type: 'task',
      title: 'Comprar máquina espresso',
      content: 'Responsable: Liam. Comparar 2 modelos de 2 grupos dentro del presupuesto.',
      status: 'todo',
      priority: 'high',
      effort: 50,
      assigneeId: 'Liam',
      boardColumnId: 'demo-col-todo',
      boardOrder: 2000,
      dueDate: daysFromNow(now, 0, 17),
      positionX: 110,
      positionY: 80,
    }),
    makeNode({
      id: 'demo-task-menu',
      type: 'task',
      title: 'Diseñar menú de apertura',
      content: 'Responsable: Emma. 6 bebidas + 4 postres, precios con margen del 65%.',
      status: 'in_progress',
      priority: 'medium',
      effort: 30,
      assigneeId: 'Emma',
      boardColumnId: 'demo-col-progress',
      boardOrder: 1000,
      dueDate: daysFromNow(now, 0, 20),
      positionX: -220,
      positionY: 240,
    }),
    makeNode({
      id: 'demo-task-pintar',
      type: 'task',
      title: 'Pintar y decorar el salón',
      content: 'Responsable: Liam. Muros color arena según las ideas de decoración.',
      status: 'in_progress',
      priority: 'medium',
      effort: 40,
      assigneeId: 'Liam',
      boardColumnId: 'demo-col-progress',
      boardOrder: 2000,
      dueDate: daysFromNow(now, 1, 18),
      positionX: 0,
      positionY: 240,
    }),
    makeNode({
      id: 'demo-task-barista',
      type: 'task',
      title: 'Contratar barista de fin de semana',
      content: 'Responsable: Oliver. Entrevistar 3 candidaturas, prueba en barra.',
      status: 'todo',
      priority: 'medium',
      effort: 25,
      assigneeId: 'Oliver',
      boardColumnId: 'demo-col-todo',
      boardOrder: 3000,
      dueDate: daysFromNow(now, 3, 12),
      positionX: 220,
      positionY: 240,
    }),
    makeNode({
      id: 'demo-task-fiesta',
      type: 'task',
      title: 'Fiesta de inauguración para vecinos',
      content: 'Responsable: Oliver. Degustación gratuita el sábado, invitar cuadra por cuadra.',
      status: 'todo',
      priority: 'low',
      effort: 35,
      assigneeId: 'Oliver',
      boardColumnId: 'demo-col-todo',
      boardOrder: 4000,
      dueDate: daysFromNow(now, 7, 18),
      positionX: 0,
      positionY: 400,
    }),
    makeNode({
      id: 'demo-note-deco',
      type: 'note',
      title: 'Ideas de decoración',
      content: 'Muros color arena, plantas colgantes y fotos del barrio enmarcadas.',
      positionX: -320,
      positionY: -140,
    }),
    makeNode({
      id: 'demo-person-emma',
      type: 'person',
      title: 'Emma — repostería y menú',
      content: 'Se encarga del menú y los postres de apertura.',
      positionX: 300,
      positionY: -80,
    }),
    makeNode({
      id: 'demo-person-liam',
      type: 'person',
      title: 'Liam — local y obra',
      content: 'Buscó el local y coordina la pintura y la máquina.',
      positionX: 300,
      positionY: 80,
    }),
    makeNode({
      id: 'demo-person-oliver',
      type: 'person',
      title: 'Oliver — personal y fiesta',
      content: 'Entrevista baristas y organiza la inauguración.',
      positionX: 300,
      positionY: 240,
    }),
    makeNode({
      id: 'demo-res-plan',
      type: 'resource',
      title: 'Presupuesto de apertura',
      content: 'Hoja con gastos del local, la máquina y la fiesta.',
      positionX: 0,
      positionY: -160,
    }),
  ]

  const edges: Edge[] = [
    makeEdge({ id: 'demo-edge-1', sourceId: 'demo-task-maquina', targetId: 'demo-task-permiso', type: 'depends_on', label: 'sin permiso no compro' }),
    makeEdge({ id: 'demo-edge-2', sourceId: 'demo-task-pintar', targetId: 'demo-task-local', type: 'depends_on', label: 'sin local no pinto' }),
    makeEdge({ id: 'demo-edge-3', sourceId: 'demo-task-fiesta', targetId: 'demo-task-permiso', type: 'depends_on', label: 'sin permiso no hay fiesta' }),
    makeEdge({ id: 'demo-edge-4', sourceId: 'demo-person-emma', targetId: 'demo-task-menu', type: 'related_to', label: 'responsable' }),
    makeEdge({ id: 'demo-edge-5', sourceId: 'demo-person-liam', targetId: 'demo-task-maquina', type: 'related_to', label: 'compara modelos' }),
    makeEdge({ id: 'demo-edge-6', sourceId: 'demo-note-deco', targetId: 'demo-task-pintar', type: 'related_to', label: 'inspiración' }),
    makeEdge({ id: 'demo-edge-7', sourceId: 'demo-res-plan', targetId: 'demo-task-maquina', type: 'related_to', label: 'presupuesto' }),
  ]

  return { nodes, edges }
}

export type DemoBucket = 'overdue' | 'today' | 'upcoming' | 'done'

function startOfDay(d: Date): Date {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}

/**
 * Agrupa tareas demo en buckets de Hoy (puro y testeable).
 * - overdue: vencida y sin terminar · today: vence hoy · upcoming: futura
 * - done: terminada (aunque tenga fecha pasada).
 */
export function getDemoBuckets(
  nodes: Node[],
  now: Date = new Date()
): Record<DemoBucket, Node[]> {
  const buckets: Record<DemoBucket, Node[]> = { overdue: [], today: [], upcoming: [], done: [] }
  const todayStart = startOfDay(now).getTime()
  const tomorrowStart = todayStart + 24 * 60 * 60 * 1000
  for (const n of nodes) {
    if (n.type !== 'task') continue
    if (n.status === 'done') {
      buckets.done.push(n)
      continue
    }
    const due = n.dueDate ? new Date(n.dueDate).getTime() : null
    if (due == null) {
      buckets.upcoming.push(n)
      continue
    }
    if (due < todayStart) buckets.overdue.push(n)
    else if (due < tomorrowStart) buckets.today.push(n)
    else buckets.upcoming.push(n)
  }
  return buckets
}

/**
 * Columnas demo del tablero (3 por defecto, ids estables para fixtures).
 * No tocan DB: solo alimentan el board-store en modo demo.
 */
export function getDemoBoardColumns(): import('@/lib/db/schema').BoardColumn[] {
  return [
    {
      id: 'demo-col-todo',
      workspaceId: DEMO_WORKSPACE_ID,
      title: 'Por hacer',
      position: 0,
      createdAt: DEMO_CREATED_AT,
      updatedAt: DEMO_CREATED_AT,
    },
    {
      id: 'demo-col-progress',
      workspaceId: DEMO_WORKSPACE_ID,
      title: 'En progreso',
      position: 1000,
      createdAt: DEMO_CREATED_AT,
      updatedAt: DEMO_CREATED_AT,
    },
    {
      id: 'demo-col-done',
      workspaceId: DEMO_WORKSPACE_ID,
      title: 'Hecho',
      position: 2000,
      createdAt: DEMO_CREATED_AT,
      updatedAt: DEMO_CREATED_AT,
    },
  ]
}

/**
 * Convierte el grafo del store al body de POST /api/ai/chat-demo
 * (mismo shape que el contrato zod §1.3 del diseño F4.1).
 */
export function demoGraphToPayload(g: { nodes: Node[]; edges: Edge[] }) {
  return {
    nodes: g.nodes.map(serializeNode),
    edges: g.edges.map(serializeEdge),
  }
}
