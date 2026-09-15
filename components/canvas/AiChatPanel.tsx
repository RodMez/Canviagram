'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
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
// usa 7 tools estáticos (buildDemoTools) → isStaticToolUIPart; los
// dynamic-tool no aplican aquí.
//
// `appliedToolCalls` es el Set de dedupe por toolCallId del turno:
// el snapshot del mensaje se re-emite en cada chunk del stream, así
// que el mismo tool-result llega varias veces; solo se aplica la
// primera. Pura y testable sin DOM.
//
// `layoutGraph` (F5.2) es multi-evento: su output trae TODOS los nodos
// con posiciones nuevas y se despacha un node:updated por nodo (el
// reducer fusiona por id, solo cambian positionX/Y en la práctica).
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
    const toolName = getStaticToolName(part)
    if (toolName === 'layoutGraph') {
      dispatchLayoutGraphResult(part.output, dispatch)
      continue
    }
    const event = demoToolResultToEvent(toolName, part.output)
    if (event) dispatch(event)
  }
}

function dispatchLayoutGraphResult(output: unknown, dispatch: (event: ApplyEventPayload) => void): void {
  let parsed: unknown = output
  if (typeof output === 'string') {
    try {
      parsed = JSON.parse(output)
    } catch {
      return
    }
  }
  const nodes = (parsed as { nodes?: unknown })?.nodes
  if (!Array.isArray(nodes)) return
  for (const node of nodes) {
    if (node && typeof node === 'object' && 'id' in node) {
      dispatch({ event: 'node:updated', data: node })
    }
  }
}

// ============================================================
// Feedback visible de las tools (web REAL): reduce las tool parts
// ejecutadas del turno a una línea resumen ("creé 2 nodos · 1 conexión").
// Consume el mismo Set de dedupe por toolCallId (cada snapshot del
// stream re-emite el mensaje completo). Puro y testable sin DOM.
// ============================================================
const TOOL_VERB_NOUN: Record<string, { v: string; s: string; p: string }> = {
  createNode: { v: 'creé', s: '1 nodo', p: 'N nodos' },
  updateNode: { v: 'actualicé', s: '1 nodo', p: 'N nodos' },
  deleteNode: { v: 'borré', s: '1 nodo', p: 'N nodos' },
  createEdge: { v: 'creé', s: '1 conexión', p: 'N conexiones' },
  deleteEdge: { v: 'borré', s: '1 conexión', p: 'N conexiones' },
}

export function summarizeToolParts(
  parts: UIMessage['parts'],
  appliedToolCalls: Set<string>
): string | null {
  const counts = new Map<string, number>()
  const createdWs: string[] = []
  const renamedWs: string[] = []
  const switchedWs: string[] = []
  let relayout = false

  for (const part of parts) {
    if (!isStaticToolUIPart(part)) continue
    if (part.state !== 'output-available') continue
    if (appliedToolCalls.has(part.toolCallId)) continue
    appliedToolCalls.add(part.toolCallId)
    const toolName = getStaticToolName(part)
    if (toolName === 'layoutGraph') {
      relayout = true
      continue
    }
    if (toolName in TOOL_VERB_NOUN) {
      counts.set(toolName, (counts.get(toolName) ?? 0) + 1)
      continue
    }
    const w = (part.output as { workspace?: { name?: string } })?.workspace?.name
    if (toolName === 'createWorkspace' && w) createdWs.push(w)
    else if (toolName === 'renameWorkspace' && w) renamedWs.push(w)
    else if (toolName === 'switchWorkspace' && w) switchedWs.push(w)
  }

  const fragments: string[] = []
  for (const [toolName, n] of counts) {
    const meta = TOOL_VERB_NOUN[toolName]!
    fragments.push(n === 1 ? `${meta.v} ${meta.s}` : `${meta.v} ${meta.p.replace('N', String(n))}`)
  }
  if (relayout) fragments.push('reorganicé el layout')
  if (createdWs.length) fragments.push(`creé el workspace ${createdWs.join(', ')}`)
  if (renamedWs.length) fragments.push(`renombré ${renamedWs.join(', ')}`)
  if (switchedWs.length) fragments.push(`cambiando a ${switchedWs.join(', ')}`)
  return fragments.length > 0 ? fragments.join(' · ') : null
}

// Extrae el destino de la tool switchWorkspace (si se ejecutó en el stream).
export function extractSwitchToolPart(
  parts: UIMessage['parts']
): { id: string; slug: string } | null {
  for (const part of parts) {
    if (!isStaticToolUIPart(part)) continue
    if (part.state !== 'output-available') continue
    if (getStaticToolName(part) !== 'switchWorkspace') continue
    const w = (part.output as { workspace?: { id?: string; slug?: string } })?.workspace
    if (w?.id && w?.slug) return { id: w.id, slug: w.slug }
  }
  return null
}

// Chat IA (Diseño 12.2). Consume el UIMessageStream SSE que devuelve el route
// /api/ai/chat (F3.4d, M2): `createUIMessageStreamResponse`. Acumula el texto del
// asistente en el último mensaje assistant; los tool calls no se muestran como texto
// (el canvas los refleja vía SSE applyEvent).
//
// Modo demo (F4.1): endpoint /api/ai/chat-demo, body con el grafo del store
// (demoGraphToPayload) y tool-results aplicados localmente vía applyLocalEvent.
export function AiChatPanel({ workspaceId, sseStatus = 'connected' }: AiChatPanelProps) {
  const router = useRouter()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<'idle' | 'streaming' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [toolSummary, setToolSummary] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string; slug: string } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Dedupe por toolCallId por turno: el snapshot del mensaje se re-emite en cada chunk.
  const appliedToolCallsRef = useRef<Set<string>>(new Set())
  const switchedRef = useRef(false)

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

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete) return
    try {
      const res = await fetch(`/api/workspaces/${pendingDelete.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmSlug: pendingDelete.slug }),
      })
      if (!res.ok) throw new Error(`delete failed (${res.status})`)
      setPendingDelete(null)
      router.push('/workspaces')
    } catch (err) {
      console.error('[AiChatPanel] no se pudo borrar el workspace', err)
      setErrorMessage('No se pudo borrar el workspace.')
      setPendingDelete(null)
    }
  }, [pendingDelete, router])

  const handleSubmit = useCallback(async () => {
    const text = input.trim()
    if (!text || status === 'streaming') return
    setInput('')
    setStatus('streaming')
    setErrorMessage(null)
    setToolSummary(null)
    setPendingDelete(null)
    appliedToolCallsRef.current = new Set()
    switchedRef.current = false

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

      // Paridad con el bot: el server puede responder JSON en vez de stream para
      // intents determinísticos: { switch }, { switchOptions } o borrado con
      // confirmación ({ deleteConfirm } / deleteOptions / deleteNotFound / deleteGuide).
      const contentType = res.headers.get('content-type') ?? ''
      if (!isDemo && contentType.includes('application/json')) {
        const data = (await res.json()) as {
          switch?: { id: string; name: string; slug: string; alreadyActive?: boolean }
          switchOptions?: { query: string; matches: { id: string; name: string; slug: string }[] }
          deleteConfirm?: { id: string; name: string; slug: string }
          deleteDenied?: { name: string }
          deleteOptions?: { query: string; matches: { id: string; name: string; slug: string }[] }
          deleteNotFound?: { query: string; names: string[] }
          deleteGuide?: boolean
        }
        if (data.switch) {
          if (data.switch.alreadyActive) {
            const assistantMsg: ChatMessage = { role: 'assistant', content: `Ya estás en ${data.switch.name}.` }
            setMessages((prev) => [...prev, assistantMsg])
            await persistTurn(userMsg, assistantMsg)
            setStatus('idle')
            return
          }
          const assistantMsg: ChatMessage = { role: 'assistant', content: `Cambiando a ${data.switch.name}…` }
          setMessages((prev) => [...prev, assistantMsg])
          await persistTurn(userMsg, assistantMsg)
          setStatus('idle')
          router.push(`/w/${data.switch.slug}`)
          return
        }
        if (data.switchOptions) {
          const names = data.switchOptions.matches.map((m) => m.name).join(', ')
          const assistantMsg: ChatMessage = {
            role: 'assistant',
            content:
              data.switchOptions.query
                ? `Encontré ${data.switchOptions.matches.length} workspaces para "${data.switchOptions.query}": ${names}. Precisa con "usa <nombre>" o elígeme uno.`
                : `¿A cuál workspace quieres cambiar? Los disponibles: ${names}. Di "usa <nombre>".`,
          }
          setMessages((prev) => [...prev, assistantMsg])
          await persistTurn(userMsg, assistantMsg)
          setStatus('idle')
          return
        }
        if (data.deleteConfirm) {
          const assistantMsg: ChatMessage = {
            role: 'assistant',
            content: `¿Confirmo que quieres borrar el workspace «${data.deleteConfirm.name}»? Esta acción es irreversible.`,
          }
          setMessages((prev) => [...prev, assistantMsg])
          setPendingDelete(data.deleteConfirm)
          await persistTurn(userMsg, assistantMsg)
          setStatus('idle')
          return
        }
        if (data.deleteDenied) {
          const assistantMsg: ChatMessage = {
            role: 'assistant',
            content: `Solo el propietario puede borrar el workspace «${data.deleteDenied.name}».`,
          }
          setMessages((prev) => [...prev, assistantMsg])
          await persistTurn(userMsg, assistantMsg)
          setStatus('idle')
          return
        }
        if (data.deleteOptions) {
          const names = data.deleteOptions.matches.map((m) => m.name).join(', ')
          const assistantMsg: ChatMessage = {
            role: 'assistant',
            content: `Encontré ${data.deleteOptions.matches.length} workspaces para "${data.deleteOptions.query}": ${names}. Precisa con "borra <nombre>".`,
          }
          setMessages((prev) => [...prev, assistantMsg])
          await persistTurn(userMsg, assistantMsg)
          setStatus('idle')
          return
        }
        if (data.deleteNotFound) {
          const names = data.deleteNotFound.names.join(', ')
          const assistantMsg: ChatMessage = {
            role: 'assistant',
            content: `No encontré el workspace «${data.deleteNotFound.query}». Tus workspaces: ${names || '(ninguno)'}.`,
          }
          setMessages((prev) => [...prev, assistantMsg])
          await persistTurn(userMsg, assistantMsg)
          setStatus('idle')
          return
        }
        if (data.deleteGuide) {
          const assistantMsg: ChatMessage = {
            role: 'assistant',
            content: '¿Cuál workspace quieres borrar? Di por ejemplo: "borra el workspace Mi Proyecto". Tiene confirmación.',
          }
          setMessages((prev) => [...prev, assistantMsg])
          await persistTurn(userMsg, assistantMsg)
          setStatus('idle')
          return
        }
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
          // Modo real: detecta switchWorkspace para navegar y resume las tools
          // ejecutadas como feedback visible bajo la respuesta.
          onMessage: (message) => {
            if (isDemo) {
              applyToolResultToCanvas(message.parts, applyLocalEvent, appliedToolCallsRef.current)
            } else if (!switchedRef.current) {
              const target = extractSwitchToolPart(message.parts)
              if (target) {
                switchedRef.current = true
                router.push(`/w/${target.slug}`)
              }
            }
            const summary = summarizeToolParts(message.parts, appliedToolCallsRef.current)
            if (summary) setToolSummary(summary)
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
  }, [input, messages, status, workspaceId, isDemo, nodes, edges, applyLocalEvent, persistTurn, router])

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
        {toolSummary && status !== 'streaming' && (
          <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5 text-xs text-emerald-700">
            ✓ {toolSummary}
          </div>
        )}
        {pendingDelete && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="font-medium text-destructive">
              ¿Borrar el workspace «{pendingDelete.name}»?
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Esta acción es irreversible: se eliminan nodos, conexiones, tareas y miembros.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="rounded bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground transition-opacity active:opacity-80"
              >
                Sí, borrar
              </button>
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="rounded border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
              >
                Cancelar
              </button>
            </div>
          </div>
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
          className="h-11 w-full rounded-lg border border-border bg-background px-3 text-base outline-none focus:ring-2 focus:ring-ring sm:text-sm"
        />
        <button
          type="submit"
          disabled={status === 'streaming' || !input.trim()}
          className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity active:opacity-80 disabled:opacity-50"
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