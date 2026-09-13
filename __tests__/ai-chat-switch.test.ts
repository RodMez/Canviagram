import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/auth/workspace-access', () => ({ assertWorkspaceAccess: vi.fn() }))
vi.mock('@/lib/canvas/workspace-by-slug', () => ({ listWorkspacesForUser: vi.fn() }))
vi.mock('@/lib/ai/provider', () => ({ isAIEnabled: vi.fn(), callWithFallback: vi.fn() }))
vi.mock('@/lib/canvas-service', () => ({ getWorkspaceGraph: vi.fn() }))

import { POST } from '@/app/api/ai/chat/route'
import { getSession } from '@/lib/auth/session'
import { assertWorkspaceAccess } from '@/lib/auth/workspace-access'
import { listWorkspacesForUser } from '@/lib/canvas/workspace-by-slug'
import { isAIEnabled } from '@/lib/ai/provider'

const mSession = vi.mocked(getSession)
const mAssert = vi.mocked(assertWorkspaceAccess)
const mList = vi.mocked(listWorkspacesForUser)
const mEnabled = vi.mocked(isAIEnabled)

const USER_ID = 'u-switch'
const CURRENT = 'ws-current'
const ALFA = { id: 'ws-alfa', name: 'Proyecto Alfa', slug: 'proyecto-alfa' }
const BETA = { id: 'ws-beta', name: 'Proyecto Beta', slug: 'proyecto-beta' }

function req(text: string, workspaceId = CURRENT) {
  return new Request('http://localhost/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId, messages: [{ role: 'user', content: text }] }),
  })
}

describe('POST /api/ai/chat switch por lenguaje natural', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mSession.mockResolvedValue({ userId: USER_ID, token: 't' })
    mAssert.mockImplementation(async (id: string) => ({ workspace: { id, name: 'W', slug: 'w' }, role: 'member' }) as never)
    mList.mockResolvedValue([ALFA, BETA] as never)
    mEnabled.mockReturnValue(false)
  })

  it('401 sin sesión', async () => {
    mSession.mockResolvedValue(null)
    expect((await POST(req('usa alfa'))).status).toBe(401)
  })

  it('single antes de IA: responde switch aunque IA deshabilitada', async () => {
    mAssert.mockImplementation(async (id: string) => {
      if (id === CURRENT) return { workspace: { id, name: 'Actual', slug: 'actual' }, role: 'member' } as never
      return { workspace: ALFA, role: 'member' } as never
    })
    const res = await POST(req('usa alfa'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({
      switch: { id: ALFA.id, name: ALFA.name, slug: ALFA.slug, alreadyActive: false },
    })
  })

  it('mismo workspace responde alreadyActive', async () => {
    mAssert.mockImplementation(async (id: string) => {
      if (id === CURRENT) return { workspace: { id, name: 'Actual', slug: 'actual' }, role: 'member' } as never
      return { workspace: { id: CURRENT, name: 'Actual', slug: 'actual' }, role: 'member' } as never
    })
    mList.mockResolvedValue([{ id: CURRENT, name: 'Actual', slug: 'actual' }] as never)
    const res = await POST(req('usa actual'))
    expect(await res.json()).toEqual({
      switch: { id: CURRENT, name: 'Actual', slug: 'actual', alreadyActive: true },
    })
  })

  it('multi responde switchOptions sin llamar al LLM', async () => {
    const res = await POST(req('usa proyecto'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.switchOptions.query).toBe('proyecto')
    expect(body.switchOptions.matches).toHaveLength(2)
  })

  it('sin match cae al flujo normal (503 con IA deshabilitada)', async () => {
    const res = await POST(req('crea una tarea de compras'))
    expect(res.status).toBe(503)
  })
})
