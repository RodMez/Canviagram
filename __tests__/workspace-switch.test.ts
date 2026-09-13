import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ForbiddenError } from '@/lib/errors'

vi.mock('@/lib/canvas/workspace-by-slug', () => ({ listWorkspacesForUser: vi.fn() }))
vi.mock('@/lib/auth/workspace-access', () => ({ assertWorkspaceAccess: vi.fn() }))

import {
  SWITCH_RE,
  normalizeWs,
  matchWorkspace,
  extractSwitchQuery,
  resolveSwitchTarget,
} from '@/lib/workspace/switch'
import { listWorkspacesForUser } from '@/lib/canvas/workspace-by-slug'
import { assertWorkspaceAccess } from '@/lib/auth/workspace-access'

const mList = vi.mocked(listWorkspacesForUser)
const mAssert = vi.mocked(assertWorkspaceAccess)

const WS = [
  { id: 'a', name: 'Proyecto Alfa', slug: 'proyecto-alfa' },
  { id: 'b', name: 'Proyecto Beta', slug: 'proyecto-beta' },
]

describe('lib/workspace/switch (paridad bot/web)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('normalizeWs: minusculas, sin tildes, guiones a espacio', () => {
    expect(normalizeWs('  Proyecto-Ágil_X  ')).toBe('proyecto agil x')
    expect(normalizeWs('BOT-WS')).toBe('bot ws')
  })

  it('matchWorkspace: subcadena en ambos sentidos', () => {
    expect(matchWorkspace('alfa', WS).map((w) => w.id)).toEqual(['a'])
    expect(matchWorkspace('PROYECTO', WS)).toHaveLength(2)
    expect(matchWorkspace('zzz', WS)).toHaveLength(0)
    expect(matchWorkspace('', WS)).toHaveLength(0)
  })

  it('SWITCH_RE + extractSwitchQuery: reglas de intercept', () => {
    expect('usar mi proyecto'.match(SWITCH_RE)?.[1]).toBe('mi proyecto')
    expect(extractSwitchQuery('cambia a Alfa')).toBe('Alfa')
    expect(extractSwitchQuery('switch to beta')).toBe('beta')
    expect(extractSwitchQuery('hola mundo')).toBeNull()
    expect(extractSwitchQuery('/usar alfa')).toBeNull()
    expect(extractSwitchQuery('usa x')).toBeNull() // <2 chars
    expect(extractSwitchQuery('usa a\nb')).toBeNull() // newline
  })

  it('resolveSwitchTarget single valida acceso', async () => {
    mList.mockResolvedValue(WS as never)
    mAssert.mockResolvedValue({ workspace: WS[0], role: 'member' } as never)
    const target = await resolveSwitchTarget('u1', 'alfa')
    expect(target).toEqual({ kind: 'single', workspace: WS[0] })
    expect(mAssert).toHaveBeenCalledWith('a', 'u1', 'viewer')
  })

  it('resolveSwitchTarget multi y none', async () => {
    mList.mockResolvedValue(WS as never)
    const multi = await resolveSwitchTarget('u1', 'proyecto')
    expect(multi.kind).toBe('multi')
    const none = await resolveSwitchTarget('u1', 'zzz')
    expect(none.kind).toBe('none')
  })

  it('resolveSwitchTarget sin acceso revocado cae a none', async () => {
    mList.mockResolvedValue(WS as never)
    mAssert.mockRejectedValue(new ForbiddenError('sin acceso'))
    const target = await resolveSwitchTarget('u1', 'alfa')
    expect(target.kind).toBe('none')
  })

  it('resolveSwitchTarget sin workspaces es empty', async () => {
    mList.mockResolvedValue([])
    expect(await resolveSwitchTarget('u1', 'alfa')).toEqual({ kind: 'empty' })
  })
})
