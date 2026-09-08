import { describe, it, expect } from 'vitest'
import { hashToken, tokensEqual } from '@/lib/auth/tokens'

describe('lib/auth/tokens', () => {
  it('hashToken es determinista y devuelve 64 hex lowercase', () => {
    const token = 'abc-123'
    expect(hashToken(token)).toBe(hashToken(token))
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('distinto input → distinto output', () => {
    expect(hashToken('token-a')).not.toBe(hashToken('token-b'))
  })

  it('tokensEqual true para iguales, false para distintos', () => {
    expect(tokensEqual('abc', 'abc')).toBe(true)
    expect(tokensEqual('abc', 'abd')).toBe(false)
  })

  it('longitudes distintas → false sin crash', () => {
    expect(tokensEqual('abc', 'abcd')).toBe(false)
    expect(tokensEqual('', 'a')).toBe(false)
    expect(tokensEqual('a', '')).toBe(false)
  })
})