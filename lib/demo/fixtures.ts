import type { Node, Edge } from '@/lib/db/schema'
import { serializeNode, serializeEdge } from '@/lib/ai/serialize'

// ============================================================
// Fixtures de la DEMO pública (F4.1, revisada F5.1)
//
// Escena estática de 7 nodos / 5 edges con shape EXACTO de DB
// (Node/Edge de lib/db/schema.ts) para reutilizar rf.ts y
// storeToRfNodes/Edges sin cambios. Cada llamada a
// getDemoFixtures() devuelve arrays NUEVOS (reseed limpio en
// cada mount de DemoLanding). Nada de esto toca DB ni sesión.
// F5.1: sin nodo-hub `project` (un workspace = un proyecto);
// la descripción del proyecto vive en el workspace, no en el canvas.
// ============================================================

export const DEMO_WORKSPACE_ID = 'demo'

export function isDemoWorkspace(id: string): boolean {
  return id === DEMO_WORKSPACE_ID
}

export const DEMO_CREATED_AT = new Date('2026-09-01T12:00:00.000Z')

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
    dueDate: null,
    reminderOffsetMin: null,
    notifiedAt: null,
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

/**
 * Escena demo (7 nodos / 5 edges — mezcla task/note/person/resource).
 * Arrays NUEVOS en cada llamada: refrescar = remount = reseed limpio.
 */
export function getDemoFixtures(): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    makeNode({
      id: 'demo-task-1',
      type: 'task',
      title: 'Diseñar la home',
      content: 'Mockup responsive en Figma',
      status: 'todo',
      positionX: -260,
      positionY: 60,
    }),
    makeNode({
      id: 'demo-task-2',
      type: 'task',
      title: 'Redactar 3 artículos',
      content: 'De 800 a 1200 palabras cada uno',
      status: 'in_progress',
      positionX: -40,
      positionY: 60,
    }),
    makeNode({
      id: 'demo-task-3',
      type: 'task',
      title: 'Publicar en producción',
      content: 'Desplegar y verificar dominio',
      status: 'done',
      positionX: 180,
      positionY: 60,
    }),
    makeNode({
      id: 'demo-note-1',
      type: 'note',
      title: 'Ideas para newsletter',
      content: 'Temas: migración, IA en el trabajo, reseñas de herramientas',
      positionX: -280,
      positionY: -120,
    }),
    makeNode({
      id: 'demo-person-1',
      type: 'person',
      title: 'Ana — copywriting',
      content: 'Redacta los artículos',
      positionX: 300,
      positionY: -60,
    }),
    makeNode({
      id: 'demo-person-2',
      type: 'person',
      title: 'Luis — diseño',
      content: 'Paleta y componentes de la UI',
      positionX: 300,
      positionY: 120,
    }),
    makeNode({
      id: 'demo-res-1',
      type: 'resource',
      title: 'Template Next.js + Tailwind',
      content: 'Repo base con login y canvas',
      positionX: 0,
      positionY: -200,
    }),
  ]

  const edges: Edge[] = [
    makeEdge({ id: 'demo-edge-4', sourceId: 'demo-task-1', targetId: 'demo-task-2', type: 'depends_on', label: 'requiere' }),
    makeEdge({ id: 'demo-edge-5', sourceId: 'demo-person-1', targetId: 'demo-task-2', type: 'related_to', label: 'asignada' }),
    makeEdge({ id: 'demo-edge-6', sourceId: 'demo-person-2', targetId: 'demo-task-1', type: 'related_to', label: 'responsable' }),
    makeEdge({ id: 'demo-edge-7', sourceId: 'demo-note-1', targetId: 'demo-task-2', type: 'related_to', label: 'inspiración' }),
    makeEdge({ id: 'demo-edge-8', sourceId: 'demo-res-1', targetId: 'demo-task-3', type: 'related_to', label: 'base' }),
  ]

  return { nodes, edges }
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