export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { streamText, isStepCount, toUIMessageStream, createUIMessageStreamResponse } from 'ai'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { assertWorkspaceAccess } from '@/lib/auth/workspace-access'
import { isAIEnabled, callWithFallback } from '@/lib/ai/provider'
import { buildTools } from '@/lib/ai/tools'
import { getWorkspaceGraph } from '@/lib/canvas-service'
import { handleApiError } from '@/lib/api-helpers'

// System prompt con contexto del workspace
function buildSystemPrompt(workspaceContext: {
  nodes: Array<{ id: string; type: string; title: string; content: string | null; status: string | null }>
  edges: Array<{ id: string; sourceId: string; targetId: string; type: string; label: string | null }>
}): string {
  const nodeSummary = workspaceContext.nodes
    .map((n) => `- [${n.type}] "${n.title}" (id: ${n.id}${n.status ? `, status: ${n.status}` : ''})`)
    .join('\n')

  const edgeSummary = workspaceContext.edges
    .map((e) => `- ${e.sourceId} --[${e.type}]--> ${e.targetId}${e.label ? ` ("${e.label}")` : ''}`)
    .join('\n')

  return `Eres el asistente de Canviagram, un canvas visual de planificación.
Puedes crear, actualizar, borrar nodos y conexiones, y consultar el grafo completo.

## Estado actual del workspace
${workspaceContext.nodes.length === 0 ? '(vacío)' : ''}
Nodos:
${nodeSummary || '(ninguno)'}

Conexiones:
${edgeSummary || '(ninguna)'}

## Reglas
- Solo puedes operar sobre este workspace.
- Si el usuario pide algo fuera del canvas, redirige al contenido del workspace.
- Conecta SIEMPRE los nodos nuevos: enlaza cada nodo creado al proyecto o concepto
  padre con un borde parent_of, y encadena tareas en secuencia con depends_on.
  Antes de crear conexiones, usa queryGraph para confirmar los IDs reales.
- Todo nodo (en especial task) lleva una descripción útil en content: qué hay que hacer y por qué.
- La posición de los nodos la asigna el servidor; no la decidas ni la menciones.
- Tras crear o conectar 2+ nodos en la misma respuesta, llama a layoutGraph para que el canvas quede ordenado.
- Valida tipos de nodo y estado antes de crear (solo "task" puede tener status).
- Si hay errores de validación, informa al usuario y sugiere correcciones.
- Responde en español unless the user writes in English.`
}

// POST handler — streaming chat con AI tools.
// Zero double-publish: canvas-service ya publica internamente.
export async function POST(request: Request) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
    }

    const { messages, workspaceId } = body as {
      messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
      workspaceId: string
    }

    if (!workspaceId || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'Parámetros inválidos' }, { status: 400 })
    }

    await assertWorkspaceAccess(workspaceId, session.userId, 'viewer')

    if (!isAIEnabled()) {
      return NextResponse.json(
        { error: 'IA deshabilitada. Configura AI_API_KEY en .env' },
        { status: 503 }
      )
    }

    const graph = await getWorkspaceGraph(workspaceId, session.userId)

    const tools = buildTools({ workspaceId, userId: session.userId })

    // stopWhen: isStepCount(10) limita iteraciones tool-use.
    // Nota: el diseño usa `maxSteps: 10` (API v4); en SDK v7 se usa `stopWhen: isStepCount(10)`.
    // F5.5: el modelo se resuelve con fallback (el primario se reintenta en cada request).
    const result = await callWithFallback((model) =>
      streamText({
        model,
        system: buildSystemPrompt(graph),
        messages,
        tools,
        stopWhen: isStepCount(10),
      })
    )

    // M2 (Diseño 10.3): UIMessageStream transporta texto + tool parts (crea nodos/edges).
    // toTextStreamResponse() está deprecado en ai v7 y solo emite texto.
    return createUIMessageStreamResponse({
      stream: toUIMessageStream({ stream: result.stream }),
    })
  } catch (error) {
    return handleApiError(error)
  }
}
