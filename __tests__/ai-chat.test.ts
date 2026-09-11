import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('ai', () => ({
  streamText: vi.fn().mockReturnValue({ stream: {} }),
  isStepCount: vi.fn(() => () => false),
  toUIMessageStream: vi.fn(() => 'stream'),
  createUIMessageStreamResponse: vi.fn(() => new Response('stream-ok')),
}))
vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/auth/workspace-access', () => ({ assertWorkspaceAccess: vi.fn() }))
vi.mock('@/lib/ai/provider', () => ({
  isAIEnabled: vi.fn(),
  getLLM: vi.fn(),
  callWithFallback: vi.fn(async (fn: (model: unknown) => unknown) => fn({})),
}))
vi.mock('@/lib/ai/tools', () => ({ buildTools: vi.fn(() => ({})) }))
vi.mock('@/lib/canvas-service', () => ({ getWorkspaceGraph: vi.fn() }))

import { POST } from '@/app/api/ai/chat/route'
import { getSession } from '@/lib/auth/session'
import { assertWorkspaceAccess } from '@/lib/auth/workspace-access'
import { isAIEnabled, getLLM } from '@/lib/ai/provider'
import { buildTools } from '@/lib/ai/tools'
import { getWorkspaceGraph } from '@/lib/canvas-service'
import { streamText, toUIMessageStream, createUIMessageStreamResponse } from 'ai'
import { ForbiddenError } from '@/lib/errors'

const mSession = vi.mocked(getSession)
const mAccess = vi.mocked(assertWorkspaceAccess)
const mAIEnabled = vi.mocked(isAIEnabled)
const mGetLLM = vi.mocked(getLLM)
const mBuildTools = vi.mocked(buildTools)
const mGetGraph = vi.mocked(getWorkspaceGraph)
const mStreamText = vi.mocked(streamText)
const mToUIMessageStream = vi.mocked(toUIMessageStream)
const mCreateUIMessageStreamResponse = vi.mocked(createUIMessageStreamResponse)

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/ai/chat', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('401 sin sesión', async () => {
    mSession.mockResolvedValue(null)
    expect((await POST(makeRequest({ messages: [], workspaceId: 'ws-1' }))).status).toBe(401)
  })

  it('400 con parámetros inválidos', async () => {
    mSession.mockResolvedValue({ userId: 'u1', token: 't' })
    expect((await POST(makeRequest({ messages: [] }))).status).toBe(400)
    expect((await POST(makeRequest({ workspaceId: 'ws-1', messages: 'bad' }))).status).toBe(400)
  })

  it('403 si usuario no tiene acceso al workspace', async () => {
    mSession.mockResolvedValue({ userId: 'u1', token: 't' })
    mAccess.mockRejectedValue(new ForbiddenError('No perteneces a este workspace'))
    expect((await POST(makeRequest({ messages: [], workspaceId: 'ws-1' }))).status).toBe(403)
  })

  it('503 si AI_API_KEY no está configurado', async () => {
    mSession.mockResolvedValue({ userId: 'u1', token: 't' })
    mAccess.mockResolvedValue({ role: 'viewer', workspace: {} as any })
    mAIEnabled.mockReturnValue(false)
    const res = await POST(makeRequest({ messages: [], workspaceId: 'ws-1' }))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toContain('deshabilitada')
  })

  it('200 streaming válido con todo configurado', async () => {
    mSession.mockResolvedValue({ userId: 'u1', token: 't' })
    mAccess.mockResolvedValue({ role: 'viewer', workspace: {} as any })
    mAIEnabled.mockReturnValue(true)
    mGetLLM.mockReturnValue({} as any)
    mGetGraph.mockResolvedValue({ nodes: [], edges: [] })
    mBuildTools.mockReturnValue({} as any)
    mStreamText.mockReturnValue({ stream: {} } as any)
    const res = await POST(makeRequest({ messages: [{ role: 'user', content: 'Crea un nodo' }], workspaceId: 'ws-1' }))
    expect(res.status).toBe(200)
    expect(mStreamText).toHaveBeenCalledTimes(1)
    expect(mGetGraph).toHaveBeenCalledWith('ws-1', 'u1')
    expect(mBuildTools).toHaveBeenCalledWith({ workspaceId: 'ws-1', userId: 'u1' })
  })

  it('M2: emite UIMessageStream (createUIMessageStreamResponse + toUIMessageStream) — contrato que consume el client', async () => {
    // Refuerzo M2: el server debe responder con el formato UIMessageStream
    // (SSE de chunks JSON) que el client consume vía readUIMessageStream.
    // Si esto cambia a toTextStreamResponse, el client (AiChatPanel) se rompe.
    mSession.mockResolvedValue({ userId: 'u1', token: 't' })
    mAccess.mockResolvedValue({ role: 'viewer', workspace: {} as any })
    mAIEnabled.mockReturnValue(true)
    mGetLLM.mockReturnValue({} as any)
    mGetGraph.mockResolvedValue({ nodes: [], edges: [] })
    mBuildTools.mockReturnValue({} as any)
    mStreamText.mockReturnValue({ stream: {} } as any)

    await POST(makeRequest({ messages: [{ role: 'user', content: 'Hola' }], workspaceId: 'ws-1' }))

    // El server convierte el stream de streamText a UIMessageStream y lo envuelve
    // en createUIMessageStreamResponse (NO toTextStreamResponse).
    expect(mToUIMessageStream).toHaveBeenCalledTimes(1)
    expect(mCreateUIMessageStreamResponse).toHaveBeenCalledTimes(1)
    const createArgs = mCreateUIMessageStreamResponse.mock.calls[0][0]
    expect(createArgs.stream).toBe('stream')
  })
})
