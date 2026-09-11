import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    streamText: vi.fn().mockReturnValue({ stream: {} }),
    isStepCount: vi.fn(() => () => false),
    toUIMessageStream: vi.fn(() => 'stream'),
    createUIMessageStreamResponse: vi.fn(() => new Response('stream-ok')),
  }
})
vi.mock('@/lib/ai/provider', () => ({ isAIEnabled: vi.fn(), getLLM: vi.fn() }))

import { POST } from '@/app/api/ai/chat-demo/route'
import { isAIEnabled, getLLM } from '@/lib/ai/provider'
import { streamText, toUIMessageStream, createUIMessageStreamResponse } from 'ai'
import type { UIMessage } from 'ai'
import { buildDemoTools } from '@/lib/ai/tools-demo'
import { getDemoFixtures } from '@/lib/demo/fixtures'
import { cloneGraph } from '@/lib/demo/graph-ops'
import { demoToolResultToEvent, applyToolResultToCanvas } from '@/components/canvas/AiChatPanel'

const mAIEnabled = vi.mocked(isAIEnabled)
const mGetLLM = vi.mocked(getLLM)
const mStreamText = vi.mocked(streamText)
const mToUIMessageStream = vi.mocked(toUIMessageStream)
const mCreateUIMessageStreamResponse = vi.mocked(createUIMessageStreamResponse)

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/ai/chat-demo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validBody = {
  messages: [{ role: 'user', content: 'hola' }],
  graph: { nodes: [], edges: [] },
}

describe('POST /api/ai/chat-demo', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('400 con body inválido (mensaje zod)', async () => {
    const res = await POST(makeRequest({ messages: [], graph: { nodes: [], edges: [] } }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBeTruthy()
  })

  it('400 con JSON malformado', async () => {
    const req = new Request('http://localhost/api/ai/chat-demo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{no-json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('400 si el grafo excede los caps (más de 300 nodos)', async () => {
    const nodes = Array.from({ length: 301 }, (_, i) => ({
      id: `n${i}`,
      type: 'task',
      title: `T${i}`,
      positionX: 0,
      positionY: 0,
    }))
    const res = await POST(makeRequest({ messages: [{ role: 'user', content: 'x' }], graph: { nodes, edges: [] } }))
    expect(res.status).toBe(400)
  })

  it('503 sin AI_API_KEY con mensaje claro', async () => {
    mAIEnabled.mockReturnValue(false)
    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toContain('deshabilitada')
  })

  it('200 UIMessageStream con todo configurado (wire idéntico a /api/ai/chat)', async () => {
    mAIEnabled.mockReturnValue(true)
    mGetLLM.mockReturnValue({} as any)
    mStreamText.mockReturnValue({ stream: {} } as any)

    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(200)
    expect(mStreamText).toHaveBeenCalledTimes(1)
    expect(mToUIMessageStream).toHaveBeenCalledTimes(1)
    expect(mCreateUIMessageStreamResponse).toHaveBeenCalledTimes(1)
    const createArgs = mCreateUIMessageStreamResponse.mock.calls[0][0]
    expect(createArgs.stream).toBe('stream')
  })

  it('200 con grafo poblado: streamText recibe system prompt demo y tools', async () => {
    mAIEnabled.mockReturnValue(true)
    mGetLLM.mockReturnValue({} as any)
    mStreamText.mockReturnValue({ stream: {} } as any)

    const { nodes, edges } = getDemoFixtures()
    const body = {
      messages: [{ role: 'user', content: 'crea una tarea' }],
      graph: {
        nodes: nodes.map((n) => ({
          id: n.id, type: n.type, title: n.title, content: n.content,
          status: n.status, positionX: n.positionX, positionY: n.positionY,
        })),
        edges: edges.map((e) => ({
          id: e.id, sourceId: e.sourceId, targetId: e.targetId, type: e.type, label: e.label,
        })),
      },
    }
    await POST(makeRequest(body))

    const streamArgs = mStreamText.mock.calls[0][0]
    expect(streamArgs.system).toContain('DEMO pública')
    expect(streamArgs.system).toContain('demo-task-2')
    expect(streamArgs.system).toContain('demo-task-1 --[depends_on]--> demo-task-2')
    const tools = streamArgs.tools as Record<string, unknown>
    expect(tools).toBeDefined()
    expect(tools.createNode).toBeDefined()
    expect(tools.queryGraph).toBeDefined()
  })
})

describe('buildDemoTools — graph mutado por tools (publish local)', () => {
  it('createNode muta el grafo en memoria y retorna nodo serializado', async () => {
    const graph = cloneGraph(getDemoFixtures())
    const tools = buildDemoTools({ graph })
    const opts = { toolCallId: 'call-1', messages: [], context: {} }

    const result = await tools.createNode.execute!(
      { type: 'task', title: 'Publicar post', status: 'todo' },
      opts
    )
    expect(result).toMatchObject({ type: 'task', title: 'Publicar post', status: 'todo' })
    expect(result).not.toHaveProperty('workspaceId')
    expect(graph.nodes).toHaveLength(8)
  })

  it('deleteNode cascadea edges y retorna removedEdgeIds', async () => {
    const graph = cloneGraph(getDemoFixtures())
    const tools = buildDemoTools({ graph })
    const opts = { toolCallId: 'call-1', messages: [], context: {} }

    // F5.1: sin hub demo-proj-1; demo-task-2 concentra los edges 4, 5 y 7
    const result = await tools.deleteNode.execute!({ nodeId: 'demo-task-2' }, opts)
    expect(result).toEqual({
      success: true,
      nodeId: 'demo-task-2',
      removedEdgeIds: ['demo-edge-4', 'demo-edge-5', 'demo-edge-7'],
    })
    expect(graph.nodes).toHaveLength(6)
    expect(graph.edges).toHaveLength(2)
  })

  it('queryGraph retorna nodos/edges serializados con summary', async () => {
    const graph = cloneGraph(getDemoFixtures())
    const tools = buildDemoTools({ graph })
    const opts = { toolCallId: 'call-1', messages: [], context: {} }

    const result = (await tools.queryGraph.execute!({}, opts)) as {
      nodes: unknown[]
      edges: unknown[]
      summary: string
    }
    expect(result.summary).toBe('7 nodos, 5 conexiones')
    expect(result.nodes).toHaveLength(7)
    expect(result.edges).toHaveLength(5)
  })

  it('layoutGraph reordena el grafo en memoria y devuelve nodos con posición', async () => {
    const graph = cloneGraph(getDemoFixtures())
    const tools = buildDemoTools({ graph })
    const opts = { toolCallId: 'call-1', messages: [], context: {} }

    const result = (await tools.layoutGraph.execute!({}, opts)) as {
      repositioned: number
      nodes: Array<{ id: string; positionX: number; positionY: number }>
    }
    expect(result.repositioned).toBe(7)
    expect(result.nodes).toHaveLength(7)
    // Jerarquía dagre: task-1 arriba de task-2 (depends_on)
    const t1 = result.nodes.find((n) => n.id === 'demo-task-1')!
    const t2 = result.nodes.find((n) => n.id === 'demo-task-2')!
    expect(t2.positionY).toBeGreaterThan(t1.positionY)
  })
})

describe('demoToolResultToEvent — mapa tool-result → evento local (F4.1 §2.2)', () => {

  it('createNode → node:created con el nodo serializado', () => {
    const node = { id: 'n-1', type: 'task', title: 'X', status: 'todo' }
    expect(demoToolResultToEvent('createNode', node)).toEqual({
      event: 'node:created',
      data: node,
    })
  })

  it('updateNode → node:updated con el nodo serializado', () => {
    const node = { id: 'n-1', type: 'task', title: 'Y', status: 'done' }
    expect(demoToolResultToEvent('updateNode', node)).toEqual({
      event: 'node:updated',
      data: node,
    })
  })

  it('deleteNode → node:deleted con { id, workspaceId: demo }', () => {
    expect(demoToolResultToEvent('deleteNode', { nodeId: 'n-1' })).toEqual({
      event: 'node:deleted',
      data: { id: 'n-1', workspaceId: 'demo' },
    })
  })

  it('createEdge → edge:created con el edge serializado', () => {
    const edge = { id: 'e-1', sourceId: 'a', targetId: 'b', type: 'related_to' }
    expect(demoToolResultToEvent('createEdge', edge)).toEqual({
      event: 'edge:created',
      data: edge,
    })
  })

  it('deleteEdge → edge:deleted con { id, workspaceId: demo }', () => {
    expect(demoToolResultToEvent('deleteEdge', { edgeId: 'e-1' })).toEqual({
      event: 'edge:deleted',
      data: { id: 'e-1', workspaceId: 'demo' },
    })
  })

  it('queryGraph y toolName desconocido → null (informacional, no muta)', () => {
    expect(demoToolResultToEvent('queryGraph', { nodes: [] })).toBeNull()
    expect(demoToolResultToEvent('unknownTool', {})).toBeNull()
  })

  it('result como string JSON se parsea; string inválido → null', () => {
    expect(demoToolResultToEvent('createNode', '{"id":"n-2","type":"note","title":"Z"}')).toEqual({
      event: 'node:created',
      data: { id: 'n-2', type: 'note', title: 'Z' },
    })
    expect(demoToolResultToEvent('createNode', '{no-json')).toBeNull()
  })

  it('deleteNode/deleteEdge sin id → null (defensivo)', () => {
    expect(demoToolResultToEvent('deleteNode', {})).toBeNull()
    expect(demoToolResultToEvent('deleteEdge', {})).toBeNull()
  })
})

describe('applyToolResultToCanvas — tool-result v7 → evento local (H1)', () => {
  // Snapshot UIMessage v7 realista (ai@7.0.90): part de tool estático
  // `tool-<name>` con state 'output-available' y resultado en `output`.
  const createNodeParts = [
    {
      type: 'tool-createNode',
      toolCallId: 'call-1',
      state: 'output-available',
      input: { type: 'task', title: 'Publicar post', status: 'todo' },
      output: { id: 'n-1', type: 'task', title: 'Publicar post', status: 'todo' },
    },
  ] as unknown as UIMessage['parts']

  it('aplica node:created por part tool-createNode output-available', () => {
    const dispatch = vi.fn()
    const applied = new Set<string>()

    applyToolResultToCanvas(createNodeParts, dispatch, applied)

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({
      event: 'node:created',
      data: { id: 'n-1', type: 'task', title: 'Publicar post', status: 'todo' },
    })
  })

  it('NO re-aplica el mismo toolCallId en snapshots re-emitidos (dedupe)', () => {
    const dispatch = vi.fn()
    const applied = new Set<string>()

    applyToolResultToCanvas(createNodeParts, dispatch, applied)
    applyToolResultToCanvas(createNodeParts, dispatch, applied)

    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('ignora states sin resultado (input-available, output-error) y parts no-tool', () => {
    const dispatch = vi.fn()
    const applied = new Set<string>()
    const parts = [
      { type: 'text', text: 'hola' },
      { type: 'tool-createNode', toolCallId: 'call-1', state: 'input-available', input: {} },
      {
        type: 'tool-createNode',
        toolCallId: 'call-2',
        state: 'output-error',
        input: {},
        errorText: 'boom',
      },
    ] as unknown as UIMessage['parts']

    applyToolResultToCanvas(parts, dispatch, applied)

    expect(dispatch).not.toHaveBeenCalled()
  })

  it('traduce layoutGraph output → un node:updated por nodo', () => {
    const dispatch = vi.fn()
    const applied = new Set<string>()
    const parts = [
      {
        type: 'tool-layoutGraph',
        toolCallId: 'call-9',
        state: 'output-available',
        input: {},
        output: {
          repositioned: 2,
          nodes: [
            { id: 'n-1', positionX: 0, positionY: 0 },
            { id: 'n-2', positionX: 0, positionY: 200 },
          ],
        },
      },
    ] as unknown as UIMessage['parts']

    applyToolResultToCanvas(parts, dispatch, applied)

    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(dispatch).toHaveBeenCalledWith({
      event: 'node:updated',
      data: { id: 'n-1', positionX: 0, positionY: 0 },
    })
    expect(dispatch).toHaveBeenCalledWith({
      event: 'node:updated',
      data: { id: 'n-2', positionX: 0, positionY: 200 },
    })
  })

  it('layoutGraph sin nodos no despacha nada (defensivo)', () => {
    const dispatch = vi.fn()
    const applied = new Set<string>()
    const parts = [
      {
        type: 'tool-layoutGraph',
        toolCallId: 'call-10',
        state: 'output-available',
        input: {},
        output: { repositioned: 0 },
      },
    ] as unknown as UIMessage['parts']

    applyToolResultToCanvas(parts, dispatch, applied)

    expect(dispatch).not.toHaveBeenCalled()
  })

  it('traduce deleteNode output → node:deleted', () => {
    const dispatch = vi.fn()
    const applied = new Set<string>()
    const parts = [
      {
        type: 'tool-deleteNode',
        toolCallId: 'call-3',
        state: 'output-available',
        input: { nodeId: 'n-1' },
        output: { success: true, nodeId: 'n-1', removedEdgeIds: [] },
      },
    ] as unknown as UIMessage['parts']

    applyToolResultToCanvas(parts, dispatch, applied)

    expect(dispatch).toHaveBeenCalledWith({
      event: 'node:deleted',
      data: { id: 'n-1', workspaceId: 'demo' },
    })
  })
})