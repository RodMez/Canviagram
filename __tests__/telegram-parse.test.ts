import { describe, it, expect } from 'vitest'
import { extractJsonObject, parseTelegramNode } from '@/lib/telegram/parse'

describe('extractJsonObject', () => {
  it('JSON plano válido', () => {
    expect(extractJsonObject('{"shouldCreate":true}')).toEqual({ shouldCreate: true })
  })

  it('JSON dentro de fence ```json', () => {
    const raw = '```json\n{"shouldCreate":false,"reply":"hola"}\n```'
    expect(extractJsonObject(raw)).toEqual({ shouldCreate: false, reply: 'hola' })
  })

  it('fence sin etiqueta json', () => {
    const raw = '```\n{"a":1}\n```'
    expect(extractJsonObject(raw)).toEqual({ a: 1 })
  })

  it('texto suelto antes/después del JSON', () => {
    const raw = 'Aquí tienes:\n{"node":{"title":"x"}}\nEspero que sirva.'
    expect(extractJsonObject(raw)).toEqual({ node: { title: 'x' } })
  })

  it('JSON roto → null', () => {
    expect(extractJsonObject('{"a":')).toBeNull()
  })

  it('sin llaves → null', () => {
    expect(extractJsonObject('nada que ver')).toBeNull()
  })

  it('texto vacío → null', () => {
    expect(extractJsonObject('')).toBeNull()
  })
})

describe('parseTelegramNode', () => {
  it('válido con node → datos tipados', () => {
    const parsed = parseTelegramNode(
      JSON.stringify({ shouldCreate: true, node: { type: 'task', title: 'Tarea', status: 'todo' }, reply: null })
    )
    expect(parsed).toEqual({
      shouldCreate: true,
      node: { type: 'task', title: 'Tarea', status: 'todo' },
      reply: null,
    })
  })

  it('válido reply-only', () => {
    const parsed = parseTelegramNode(
      JSON.stringify({ shouldCreate: false, node: null, reply: 'Hola' })
    )
    expect(parsed?.reply).toBe('Hola')
    expect(parsed?.node).toBeNull()
  })

  it('JSON envolver con fence → válido', () => {
    const parsed = parseTelegramNode(
      '```json\n{"shouldCreate":false,"node":null,"reply":"ok"}\n```'
    )
    expect(parsed?.reply).toBe('ok')
  })

  it('type no válido → rechazado (schema transporte)', () => {
    const parsed = parseTelegramNode(
      JSON.stringify({ shouldCreate: true, node: { type: 'xeno', title: 'x' }, reply: null })
    )
    expect(parsed).toBeNull()
  })

  it('title > 200 chars → rechazado', () => {
    const parsed = parseTelegramNode(
      JSON.stringify({ shouldCreate: true, node: { type: 'task', title: 'a'.repeat(201) }, reply: null })
    )
    expect(parsed).toBeNull()
  })

  it('sin shouldCreate → rechazado', () => {
    const parsed = parseTelegramNode(JSON.stringify({ node: { type: 'task', title: 'x' } }))
    expect(parsed).toBeNull()
  })

  it('texto no JSON → null', () => {
    expect(parseTelegramNode('no json')).toBeNull()
  })
})