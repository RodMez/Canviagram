import { describe, it, expect } from 'vitest'
import {
  resolvePanelMode,
  mapWorkspacesForMenu,
} from '@/components/canvas/Toolbar'

// ============================================================
// Toolbar / panel context switch (Diseño 13)
// Lógica pura extraída del componente para testear sin DOM.
// ============================================================

describe('resolvePanelMode (conmutador panel contextual)', () => {
  it('devuelve "node" cuando hay un nodo seleccionado', () => {
    expect(resolvePanelMode('node-1')).toBe('node')
  })

  it('devuelve "chat" cuando no hay nodo seleccionado', () => {
    expect(resolvePanelMode(null)).toBe('chat')
  })

  it('devuelve "chat" con id vacío (sin selección real)', () => {
    expect(resolvePanelMode('')).toBe('chat')
  })
})

describe('mapWorkspacesForMenu (dropdown workspace)', () => {
  it('mapea la respuesta de GET /api/workspaces a items del menú', () => {
    const workspaces = [
      { id: 'ws-1', name: 'Proyecto Alpha', slug: 'proyecto-alpha' },
      { id: 'ws-2', name: 'Beta', slug: 'beta' },
    ]
    expect(mapWorkspacesForMenu(workspaces)).toEqual([
      { id: 'ws-1', name: 'Proyecto Alpha', slug: 'proyecto-alpha' },
      { id: 'ws-2', name: 'Beta', slug: 'beta' },
    ])
  })

  it('devuelve array vacío para lista vacía', () => {
    expect(mapWorkspacesForMenu([])).toEqual([])
  })

  it('preserva el orden de llegada (owner primero, members después)', () => {
    const workspaces = [
      { id: 'ws-1', name: 'A', slug: 'a' },
      { id: 'ws-2', name: 'B', slug: 'b' },
    ]
    const mapped = mapWorkspacesForMenu(workspaces)
    expect(mapped.map((w) => w.id)).toEqual(['ws-1', 'ws-2'])
  })
})
