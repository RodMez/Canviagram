export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { streamText, isStepCount, toUIMessageStream, createUIMessageStreamResponse } from 'ai'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { assertWorkspaceAccess } from '@/lib/auth/workspace-access'
import { isAIEnabled, callWithFallback } from '@/lib/ai/provider'
import { buildTools } from '@/lib/ai/tools'
import { getWorkspaceGraph } from '@/lib/canvas-service'
import { extractSwitchQuery, resolveSwitchTarget } from '@/lib/workspace/switch'
import { handleApiError } from '@/lib/api-helpers'

// System prompt con contexto del workspace
function buildSystemPrompt(workspaceContext: {
  nodes: Array<{ id: string; type: string; title: string; content: string | null; status: string | null; priority?: string | null; effort?: number | null; assigneeId?: string | null }>
  edges: Array<{ id: string; sourceId: string; targetId: string; type: string; label: string | null }>
  members: Array<{ displayName: string; email?: string | null }>
}): string {
  const memberById = new Map<string, string>()
  const nodeSummary = workspaceContext.nodes
    .map((n) => {
      const extra = [
        n.status ? `estado: ${n.status}` : null,
        (n as { priority?: string | null }).priority ? `prioridad: ${(n as { priority?: string | null }).priority}` : null,
        (n as { effort?: number | null }).effort != null ? `esfuerzo: ${(n as { effort?: number | null }).effort}` : null,
      ]
        .filter(Boolean)
        .join(', ')
      return `- [${n.type}] "${n.title}"${extra ? ` (${extra})` : ''}`
    })
    .join('\n')

  const edgeSummary = workspaceContext.edges
    .map((e) => `- ${e.sourceId} --[${e.type}]--> ${e.targetId}${e.label ? ` ("${e.label}")` : ''}`)
    .join('\n')

  const memberLines = workspaceContext.members.map((m) => `- ${m.displayName}`).join('\n')

  return `Eres el asistente de Canviagram, un canvas visual de planificación.
Puedes crear, actualizar, borrar nodos y conexiones, y consultar el grafo completo.
También puedes administrar responsable, prioridad y esfuerzo de las tareas.

## Estado actual del workspace
${workspaceContext.nodes.length === 0 ? '(vacío)' : ''}
Nodos (los IDs son solo para tool-calls, NUNCA los muestres al usuario):
${nodeSummary || '(ninguno)'}

Conexiones:
${edgeSummary || '(ninguna)'}

Miembros del workspace (para asignar por nombre con assigneeName):
${memberLines || '(sin miembros)'}

## Reglas
- Solo puedes operar sobre este workspace.
- Si el usuario pide cambiar de workspace ("usa X"), el sistema lo redirige solo: no inventes el cambio ni operes en otro workspace.
- Si el usuario pide algo fuera del canvas, redirige al contenido del workspace.
- Puedes fijar/actualizar en tasks: priority (urgent, high, medium, low), effort (0-100) y responsable (assigneeName con el nombre del miembro o assigneeId). Si el nombre es ambiguo, usa listMembers y pide aclaración.
- Al asignar una tarea se crea automáticamente el nodo persona + relación: no los dupliques a mano.
- Conecta SIEMPRE los nodos nuevos: enlaza cada nodo creado al proyecto o concepto
  padre con un borde parent_of, y encadena tareas en secuencia con depends_on.
  Antes de crear conexiones, usa queryGraph para confirmar los IDs reales.
- Todo nodo (en especial task) lleva una descripción útil en content: qué hay que hacer y por qué.
- La posición de los nodos la asigna el servidor; no la decidas ni la menciones.
- Tras crear o conectar 2+ nodos en la misma respuesta, llama a layoutGraph para que el canvas quede ordenado.
- Valida tipos de nodo y estado antes de crear (solo "task" puede tener status/priority/effort/responsable; solo "person" puede vincularse a un usuario).
- En tu respuesta visible NUNCA muestres IDs largos/UUIDs: resume con títulos en negrita, estado, responsable, prioridad, esfuerzo y fecha. Información útil, no técnica.
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

    // Paridad con el bot: cambio de workspace por lenguaje natural ANTES de
    // todo lo costoso (sin LLM, sin grafo). "usa X" con 1 match responde
    // { switch } para que el cliente navegue; N matches devuelve opciones;
    // 0 matches cae al LLM normal. Historiales separados por workspace.
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    const switchQuery = extractSwitchQuery(
      typeof lastUser?.content === 'string' ? lastUser.content : ''
    )
    if (switchQuery) {
      const target = await resolveSwitchTarget(session.userId, switchQuery)
      if (target.kind === 'single') {
        return NextResponse.json({
          switch: {
            id: target.workspace.id,
            name: target.workspace.name,
            slug: target.workspace.slug,
            alreadyActive: target.workspace.id === workspaceId,
          },
        })
      }
      if (target.kind === 'multi') {
        return NextResponse.json({
          switchOptions: {
            query: target.query,
            matches: target.matches.map((w) => ({ id: w.id, name: w.name, slug: w.slug })),
          },
        })
      }
      // 'none' => fallthrough al LLM. 'empty' => fallthrough.
    }

    if (!isAIEnabled()) {
      return NextResponse.json(
        { error: 'IA deshabilitada. Configura AI_API_KEY en .env' },
        { status: 503 }
      )
    }

    const graph = await getWorkspaceGraph(workspaceId, session.userId)
    const { listMembersMeta } = await import('@/lib/workspace-admin')
    let members: Array<{ displayName: string; email?: string | null }> = []
    try {
      const meta = await listMembersMeta(workspaceId, session.userId)
      members = meta.members.map((m) => ({ displayName: m.displayName, email: m.email }))
    } catch {
      members = []
    }

    const tools = buildTools({ workspaceId, userId: session.userId })

    // stopWhen: isStepCount(10) limita iteraciones tool-use.
    // Nota: el diseño usa `maxSteps: 10` (API v4); en SDK v7 se usa `stopWhen: isStepCount(10)`.
    // F5.5: el modelo se resuelve con fallback (el primario se reintenta en cada request).
    const result = await callWithFallback((model) =>
      streamText({
        model,
        system: buildSystemPrompt({ ...graph, members } as never),
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
