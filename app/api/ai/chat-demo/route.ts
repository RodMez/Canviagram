export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { streamText, isStepCount, toUIMessageStream, createUIMessageStreamResponse } from 'ai'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isAIEnabled, getLLM } from '@/lib/ai/provider'
import { buildDemoTools } from '@/lib/ai/tools-demo'
import { cloneGraph, type DemoGraph } from '@/lib/demo/graph-ops'
import { DEMO_WORKSPACE_ID, DEMO_CREATED_AT } from '@/lib/demo/fixtures'
import { NODE_TYPES, NODE_STATUSES, EDGE_TYPES } from '@/lib/db/schema'
import { env } from '@/lib/env'

// ============================================================
// POST /api/ai/chat-demo — chat IA de la DEMO pública (F4.1b)
//
// Pública por diseño: eximida en middleware vía EXCLUDED_EXACT.
// NUNCA importa session/db/canvas-service/pubsub: su única
// entrada es el body validado y opera sobre un grafo clonado
// en memoria POR REQUEST (cero estado entre visitantes).
// Wire idéntico a /api/ai/chat: UIMessageStream SSE.
// ============================================================

// Contrato exacto del diseño F4.1 §1.3 (caps de mensajes y grafo).
const demoChatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(4000),
      })
    )
    .min(1)
    .max(50),
  graph: z.object({
    nodes: z
      .array(
        z.object({
          id: z.string().min(1).max(100),
          type: z.enum(NODE_TYPES),
          title: z.string().min(1).max(200),
          content: z.string().max(5000).nullable().optional(),
          status: z.enum(NODE_STATUSES).nullable().optional(),
          positionX: z.number().finite(),
          positionY: z.number().finite(),
        })
      )
      .max(300),
    edges: z
      .array(
        z.object({
          id: z.string().min(1).max(100),
          sourceId: z.string().min(1).max(100),
          targetId: z.string().min(1).max(100),
          type: z.enum(EDGE_TYPES),
          label: z.string().max(200).nullable().optional(),
        })
      )
      .max(600),
  }),
})

// System prompt demo (diseño F4.1 §1.4): mismo formato de resumen
// de nodos/edges que producción + reglas de la demo pública.
function buildDemoSystemPrompt(graph: DemoGraph): string {
  // P2 (security): presupuesto del resumen del grafo — primeros 100
  // nodos / 200 edges. No altera el uso normal (demo pequeño) y acota
  // el prompt ante grafos grandes.
  const nodeSummary = graph.nodes
    .slice(0, 100)
    .map((n) => `- [${n.type}] "${n.title}" (id: ${n.id}${n.status ? `, status: ${n.status}` : ''})`)
    .join('\n')

  const edgeSummary = graph.edges
    .slice(0, 200)
    .map((e) => `- ${e.sourceId} --[${e.type}]--> ${e.targetId}${e.label ? ` ("${e.label}")` : ''}`)
    .join('\n')

  const registerUrl = env.NEXT_PUBLIC_APP_URL
    ? `${env.NEXT_PUBLIC_APP_URL}/register`
    : 'https://canviagram.jaiver.com/register'

  return `Eres el asistente de Canviagram en la DEMO pública. Operas sobre un canvas de
demostración: nada de lo que hagas se guarda ni toca datos reales.

## Estado actual del canvas demo
${graph.nodes.length === 0 ? '(vacío)' : ''}
Nodos:
${nodeSummary || '(ninguno)'}

Conexiones:
${edgeSummary || '(ninguna)'}

## Reglas
- Solo puedes operar sobre el canvas de demostración.
- Si el usuario pregunta por guardar trabajo, cuentas reales, iniciar sesión, workspaces
  reales o cualquier cosa fuera del alcance de la demo → indícale que es una demo y
  redirígelo a crear una cuenta: ${registerUrl} (o "Crear cuenta" si es UI).
- Nunca inventes datos de usuarios ni menciones workspaces o bases de datos reales.
- Conecta SIEMPRE los nodos nuevos: enlázalos al proyecto/contexto apropiado con
  parent_of y encadena tareas en secuencia con depends_on.
- Todo nodo lleva una descripción útil en content (qué hay que hacer y por qué).
- Al crear nodos, asigna posiciones razonables respecto a la estructura existente, sin solapar.
- Valida tipos (task, note, idea, person, resource) y solo "task" puede tener status.
- Si hay errores de validación, informa y sugiere correcciones.
- Responde en español unless the user writes in English.`
}

export async function POST(request: Request) {
  // M2 (security): cap de tamaño de body ANTES de parsear JSON. Con
  // chunked encoding Content-Length puede venir nulo → el cap real lo
  // aplica zod (messages.max(50), graph caps); esto es un filtro barato.
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > 4 * 1024 * 1024) {
    return NextResponse.json({ error: 'Body demasiado grande' }, { status: 413 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const parsed = demoChatRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }

  // Check ANTES de streamText: 503 limpio y sin gasto de LLM.
  if (!isAIEnabled()) {
    return NextResponse.json(
      { error: 'IA deshabilitada. Configura AI_API_KEY en .env' },
      { status: 503 }
    )
  }

  // Clona el grafo recibido dentro del scope de la request: nada en
  // módulo-global, cero estado compartido entre visitantes.
  const graph: DemoGraph = cloneGraph({
    nodes: parsed.data.graph.nodes.map((n) => ({
      id: n.id,
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: 'demo',
      type: n.type,
      title: n.title,
      content: n.content ?? null,
      status: n.status ?? null,
      dueDate: null,
      reminderOffsetMin: null,
      notifiedAt: null,
      positionX: n.positionX,
      positionY: n.positionY,
      createdAt: DEMO_CREATED_AT,
      updatedAt: DEMO_CREATED_AT,
      deletedAt: null,
    })),
    edges: parsed.data.graph.edges.map((e) => ({
      id: e.id,
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: 'demo',
      sourceId: e.sourceId,
      targetId: e.targetId,
      type: e.type,
      label: e.label ?? null,
      createdAt: DEMO_CREATED_AT,
    })),
  })

  const tools = buildDemoTools({ graph })

  const result = streamText({
    model: getLLM(),
    system: buildDemoSystemPrompt(graph),
    messages: parsed.data.messages,
    tools,
    stopWhen: isStepCount(10),
  })

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  })
}