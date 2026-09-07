'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { isStaticToolUIPart, getStaticToolName, type UIMessage } from 'ai'
import { Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { consumeUIMessageStream } from '@/lib/ai/ui-message-stream'
import { useCanvasStore, selectNodes, selectEdges } from '@/store/canvas-store'
import { isDemoWorkspace, demoGraphToPayload, DEMO_WORKSPACE_ID } from '@/lib/demo/fixtures'
import { loadDemoChatMessages, saveDemoChatMessages, clearDemoChatMessages } from '@/lib/chat/demo-storage'
import type { ChatMessage } from '@/lib/chat/types'
import type { ApplyEventPayload } from '@/lib/sse/types'

export type SseStatus = 'connecting' | 'connected' | 'disconnected'

type AiChatPanelProps = {
  workspaceId: string
  /** Estado de la conexión SSE (B1) para el pill En línea / Reconectando. */
  sseStatus?: SseStatus
}

// ============================================================
// Mapa tool-result → evento local (F4.1 §2.2, modo demo).
// El server del chat demo comunica sus tool-calls como
// tool-result parts del UIMessageStream; aquí se traducen a
// eventos del reducer y se aplican vía applyLocalEvent.
// Defensivo: `result` puede llegar como string JSON → parse en
// try/catch; si falla se ignora ese part (null).
// ============================================================
export function demoToolResultToEvent(
  toolName: string,
  result: unknown
): ApplyEventPayload | null {
  let parsed: unknown = result
  if (typeof result === 'string') {
    try {
      parsed = JSON.parse(result)
    } catch {
      return null
    }
  }

  switch (toolName) {
    case 'createNode':
      return { event: 'node:created', data: parsed }
    case 'updateNode':
      return { event: 'node:updated', data: parsed }
    case 'deleteNode': {
      const r = parsed as { nodeId?: string }
      if (!r?.nodeId) return null
      // El reducer ya cascadea los edges al borrar el nodo.
      return { event: 'node:deleted', data: { id: r.nodeId, workspaceId: DEMO_WORKSPACE_ID } }
    }
    case 'createEdge':
      return { event: 'edge:created', data: parsed }
    case 'deleteEdge': {
      const r = parsed as { edgeId?: string }
      if (!r?.edgeId) return null
      return { event: 'edge:deleted', data: { id: r.edgeId, workspaceId: DEMO_WORKSPACE_ID } }
    }
    case 'queryGraph':
      // Informacional: el old=client es fuente del próximo request.
      return null
    default:
      return null
  }
}

// ============================================================
// Aplica tool-result parts v7 del UIMessageStream al canvas local
// (F4.1 §2.2, modo demo).
//
// Wire v7 (ai@7.0.90): los parts de tools estáticos tienen type
// `tool-<name>` (p.ej. `tool-createNode`) y el resultado de éxito
// vive en `output` con `state: 'output-available'`; el error en
// `errorText` con `state: 'output-error'`. El formato v5
// (`tool-invocation` / `state: 'result'`) NO existe en v7. El demo
// usa 6 tools estáticos (buildDemoTools) → isStaticToolUIPart; los
// dynamic-tool no aplican aquí.
//
// `appliedToolCalls` es el Set de dedupe por toolCallId del turno:
// el snapshot del mensaje se re-emite en cada chunk del stream, así
// que el mismo tool-result llega varias veces; solo se aplica la
// primera. Pura y testable sin DOM.
// ============================================================
export function applyToolResultToCanvas(
  parts: UIMessage['parts'],
  dispatch: (event: ApplyEventPayload) => void,
  appliedToolCalls: Set<string>
): void {
  for (const part of parts) {
    if (!isStaticToolUIPart(part)) continue
    if (part.state !== 'output-available') continue
    if (appliedToolCalls.has(part.toolCallId)) continue
    appliedToolCalls.add(part.toolCallId)
    const event = demoToolResultToEvent(getStaticToolName(part), part.output)
    if (event) dispatch(event)
  }
}

// Chat IA (Diseño 12.2). Consume el UIMessageStream SSE que devuelve el route
// /api/ai/chat (F3.4d, M2): `createUIMessageStreamResponse`. Acumula el texto del
// asistente en el último mensaje assistant; los tool calls no se muestran como texto
// (el canvas los refleja vía SSE applyEvent).
//
// Modo demo (F4.1): endpoint /api/ai/chat-demo, body con el grafo del store
// (demoGraphToPayload) y tool-results aplicados localmente vía applyLocalEvent.
export function AiChatPanel({ workspaceId, sseStatus = 'connected' }: AiChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<'idle' | 'streaming' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  // Dedupe por toolCallId por turno: el snapshot del mensaje se re-emite en cada chunk.
  const appliedToolCallsRef = useRef<Set<string>>(new Set())

  const isDemo = isDemoWorkspace(workspaceId)
  const nodes = useCanvasStore(selectNodes)
  const edges = useCanvasStore(selectEdges)
  const applyLocalEvent = useCanvasStore((s) => s.applyLocalEvent)

  // Persistencia (F4.4): historial en servidor por usuario/workspace; el demo
  // guarda en localStorage. Hydrate al montar para que el chat no se pierda al recargar.
  useEffect(() => {
    let cancelled = false

    if (isDemo) {
      setMessages(loadDemoChatMessages())
      setHydrated(true)
      return
    }

    fetch(`/api/workspaces/${workspaceId}/chat/messages`, { headers: { Accept: 'application/json' } })
      .then(async (res) => {
        if (!res.ok || cancelled) return
        const data = (await res.json()) as { messages: { role: 'user' | 'assistant'; content: string }[] }
        setMessages(data.messages.map((m) => ({ role: m.role, content: m.content })))
      })
      .catch((err) => console.warn('[AiChatPanel] no se pudo cargar el historial', err))
      .finally(() => {
        if (!cancelled) setHydrated(true)
      })

    return () => {
      cancelled = true
    }
  }, [workspaceId, isDemo])

  // Persiste un turno completo (usuario + asistente). Nunca rompe la UX: ante
  // fallo loguea y deja el chat funcionando en memoria.
  const persistTurn = useCallback(
    async (userMsg: ChatMessage, assistantMsg: ChatMessage) => {
      if (isDemo) {
        setMessages((prev) => {
          const next = [...prev]
          saveDemoChatMessages(next)
          return next
        })
        return
      }
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/chat/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [userMsg, assistantMsg] }),
        })
        if (!res.ok) throw new Error(`persist failed (${res.status})`)
      } catch (err) {
        console.warn('[AiChatPanel] no se pudo persistir el turno', err)
      }
    },
    [workspaceId, isDemo]
  )

  const handleClear = useCallback(async () => {
    if (!window.confirm('¿Borrar el historial de esta conversación?')) return
    if (isDemo) {
      clearDemoChatMessages()
      setMessages([])
      return
    }
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/chat/messages`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`clear failed (${res.status})`)
      setMessages([])
    } catch (err) {
      console.error('[AiChatPanel] no se pudo limpiar el historial', err)
      setErrorMessage('No se pudo limpiar el historial.')
    }
  }, [workspaceId, isDemo])

  const handleSubmit = useCallback(async () => {
    const text = input.trim()
    if (!text || status === 'streaming') return
    setInput('')
    setStatus('streaming')
    setErrorMessage(null)
    appliedToolCallsRef.current = new Set()

    const userMsg: ChatMessage = { role: 'user', content: text }
    const history = [...messages, userMsg]
    setMessages(history)
    // L3 (security): cap del historial enviado al server demo — el schema zod
    // limita a 50 mensajes; recortamos a las últimas 40 para no romperlo en
    // conversaciones largas (slice sobre el array del body, no sobre el estado).
    const demoHistory = history.slice(-40)

    const abort = new AbortController()
    abortRef.current = abort

    try {
      const res = await fetch(isDemo ? '/api/ai/chat-demo' : '/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isDemo
            ? { messages: demoHistory, graph: demoGraphToPayload({ nodes, edges }) }
            : { messages: history, workspaceId }
        ),
        signal: abort.signal,
      })
      if (!res.ok || !res.body) {
        if (res.status === 503) {
          // Demo sin AI_API_KEY: mensaje claro del server, no el error genérico.
          const data = await res.json().catch(() => null)
          throw new Error(data?.error ?? 'IA deshabilitada')
        }
        throw new Error(`Chat falló (${res.status})`)
      }

      // Reserva el mensaje assistant que se irá llenando con el texto del stream.
      setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

      let assistantContent = ''
      await consumeUIMessageStream(
        res.body,
        (text) => {
          assistantContent = text
          setMessages((prev) => {
            const next = [...prev]
            next[next.length - 1] = { role: 'assistant', content: text }
            return next
          })
        },
        {
          // Modo demo: traduce cada tool-result a un evento local (publish local).
          onMessage: (message) => {
            if (!isDemo) return
            applyToolResultToCanvas(message.parts, applyLocalEvent, appliedToolCallsRef.current)
          },
        }
      )
      await persistTurn(userMsg, { role: 'assistant', content: assistantContent })
      setStatus('idle')
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      console.error('[AiChatPanel] chat failed', err)
      setErrorMessage((err as Error).message)
      setStatus('error')
    } finally {
      abortRef.current = null
    }
  }, [input, messages, status, workspaceId, isDemo, nodes, edges, applyLocalEvent, persistTurn])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Asistente IA</h2>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              title="Limpiar conversación"
              aria-label="Limpiar conversación"
              className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Trash2 className="h-3 w-3" />
              Limpiar
            </button>
          )}
          <span
            className={cn(
              'flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium',
              sseStatus === 'connected'
                ? 'bg-emerald-500/10 text-emerald-600'
                : 'bg-amber-500/10 text-amber-600'
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                sseStatus === 'connected' ? 'bg-emerald-500' : 'animate-pulse bg-amber-500'
              )}
            />
            {sseStatus === 'connected' ? 'En línea' : 'Reconectando…'}
          </span>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {hydrated && messages.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Pregúntale a la IA sobre tu canvas o pídele crear nodos.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={cn(
              'rounded-lg px-3 py-2',
              m.role === 'user' ? 'bg-primary/10' : 'bg-muted'
            )}
          >
            <span className="mb-1 block text-[10px] font-medium uppercase text-muted-foreground">
              {m.role === 'user' ? 'Tú' : 'IA'}
            </span>
            <p className="whitespace-pre-wrap text-sm">{m.content}</p>
          </div>
        ))}
        {status === 'streaming' && (
          <span className="text-xs text-muted-foreground">…</span>
        )}
        {status === 'error' && (
          <p className="text-xs text-destructive">{errorMessage ?? 'Error al conectar con la IA.'}</p>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          handleSubmit()
        }}
        className="border-t border-border p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escribe un mensaje…"
          className="w-full rounded border bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={status === 'streaming' || !input.trim()}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {status === 'streaming' && (
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" />
          )}
          {status === 'streaming' ? 'Enviando…' : 'Enviar'}
        </button>
      </form>
    </div>
  )
}