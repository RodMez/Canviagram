import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ForbiddenError } from '@/lib/errors'

vi.mock('@/lib/canvas/workspace-by-slug', () => ({ listWorkspacesForUser: vi.fn() }))
vi.mock('@/lib/auth/workspace-access', () => ({ assertWorkspaceAccess: vi.fn() }))

import {
  SWITCH_RE,
  DELETE_SWITCH_RE,
  normalizeWs,
  matchWorkspace,
  extractSwitchQuery,
  extractDeleteQuery,
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

  it('SWITCH_RE: verbos ampliados (cámbiame/pásame/quiero trabajar en/navega)', () => {
    expect(extractSwitchQuery('cámbiame a alfa')).toBe('alfa')
    expect(extractSwitchQuery('cambiame al proyecto')).toBe('proyecto')
    expect(extractSwitchQuery('pásame al beta')).toBe('beta')
    expect(extractSwitchQuery('pasame a mi proyecto')).toBe('mi proyecto')
    expect(extractSwitchQuery('muéveme a alfa')).toBe('alfa')
    expect(extractSwitchQuery('quiero trabajar en beta')).toBe('beta')
    expect(extractSwitchQuery('quiero pasar a alfa')).toBe('alfa')
    expect(extractSwitchQuery('ir al proyecto')).toBe('proyecto')
    expect(extractSwitchQuery('navega al alfa')).toBe('alfa')
    expect(extractSwitchQuery('cambia de workspace')).toBe('workspace') // filler
  })

  it('cleanQuery: recorta preguntas y signos de interrogación', () => {
    expect(extractSwitchQuery('¿cambia a alfa?')).toBe('alfa')
    expect(extractSwitchQuery('usar "beta"')).toBe('beta')
  })

  it('DELETE_SWITCH_RE + extractDeleteQuery: borrado por lenguaje natural', () => {
    expect('borra mi proyecto'.match(DELETE_SWITCH_RE)?.[1]).toBe('mi proyecto')
    expect(extractDeleteQuery('borra alfa')).toBe('alfa')
    expect(extractDeleteQuery('elimina el beta')).toBe('beta')
    expect(extractDeleteQuery('quita mi proyecto')).toBe('mi proyecto')
    expect(extractDeleteQuery('suprime el alfa')).toBe('alfa')
    // Negativos: sin verbo, anchos <2, solo verbo (sin target), no anclado al inicio.
    expect(extractDeleteQuery('hola mundo')).toBeNull()
    expect(extractDeleteQuery('borra x')).toBeNull()
    expect(extractDeleteQuery('borra')).toBeNull()
    expect(extractDeleteQuery('oye, borra alfa')).toBeNull()
    expect(extractDeleteQuery('/borrar alfa')).toBeNull()
  })

  it('resolveSwitchTarget filler → unspecified sin consultar workspaces', async () => {
    const target = await resolveSwitchTarget('u1', 'workspace')
    expect(target.kind).toBe('unspecified')
    expect(mList).not.toHaveBeenCalled()
    expect(await resolveSwitchTarget('u1', 'canal')).toEqual({ kind: 'unspecified' })
    expect(await resolveSwitchTarget('u1', 'mi ws')).toEqual({ kind: 'unspecified' })
    expect(mList).not.toHaveBeenCalled()
  })

  it('resolveSwitchTarget query vacía → empty', async () => {
    expect(await resolveSwitchTarget('u1', '   ')).toEqual({ kind: 'empty' })
  })

  it('resolveSwitchTarget multi y none', async () => {
    mList.mockResolvedValue(WS as never)
    const multi = await resolveSwitchTarget('u1', 'proyecto')
    expect(multi.kind).toBe('multi')
    expect((multi as { matches: unknown[] }).matches).toHaveLength(2)
    const none = await resolveSwitchTarget('u1', 'zzz')
    expect(none.kind).toBe('none')
    expect((none as { all: unknown[] }).all).toHaveLength(2)
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
