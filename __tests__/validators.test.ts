import { describe, it, expect } from 'vitest'
import { registerSchema, loginSchema } from '@/lib/validators/auth'
import { createNodeSchema, updateNodeSchema } from '@/lib/validators/node'
import { createEdgeSchema, updateEdgeSchema } from '@/lib/validators/edge'
import { createWorkspaceSchema, updateWorkspaceSchema } from '@/lib/validators/workspace'

// ============================================================
// AUTH
// ============================================================

describe('auth validators', () => {
  describe('registerSchema', () => {
    it('1 - válido con datos correctos', () => {
      const result = registerSchema.safeParse({
        email: 'test@example.com',
        password: 'password123',
        displayName: 'Jaiver',
      })
      expect(result.success).toBe(true)
    })

    it('2 - email inválido', () => {
      const result = registerSchema.safeParse({
        email: 'no-es-email',
        password: 'password123',
        displayName: 'Jaiver',
      })
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error.issues[0].message).toMatch(/email/i)
    })

    it('3 - password muy corta', () => {
      const result = registerSchema.safeParse({
        email: 'test@example.com',
        password: 'short',
        displayName: 'Jaiver',
      })
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error.issues[0].message).toMatch(/8 caracteres/)
    })

    it('4 - password muy larga', () => {
      const result = registerSchema.safeParse({
        email: 'test@example.com',
        password: 'a'.repeat(129),
        displayName: 'Jaiver',
      })
      expect(result.success).toBe(false)
    })

    it('5 - displayName muy corto', () => {
      const result = registerSchema.safeParse({
        email: 'test@example.com',
        password: 'password123',
        displayName: 'A',
      })
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error.issues[0].message).toMatch(/2 caracteres/)
    })

    it('6 - displayName muy largo', () => {
      const result = registerSchema.safeParse({
        email: 'test@example.com',
        password: 'password123',
        displayName: 'A'.repeat(51),
      })
      expect(result.success).toBe(false)
    })

    it('7 - falta email', () => {
      const result = registerSchema.safeParse({
        password: 'password123',
        displayName: 'Jaiver',
      })
      expect(result.success).toBe(false)
    })

    it('8 - falta password', () => {
      const result = registerSchema.safeParse({
        email: 'test@example.com',
        displayName: 'Jaiver',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('loginSchema', () => {
    it('9 - válido', () => {
      const result = loginSchema.safeParse({
        email: 'test@example.com',
        password: 'irrelevant',
      })
      expect(result.success).toBe(true)
    })

    it('10 - email inválido', () => {
      const result = loginSchema.safeParse({
        email: 'bad',
        password: '123',
      })
      expect(result.success).toBe(false)
    })

    it('11 - falta password', () => {
      const result = loginSchema.safeParse({
        email: 'test@example.com',
        password: '',
      })
      expect(result.success).toBe(false)
    })
  })
})

// ============================================================
// NODE
// ============================================================

describe('node validators', () => {
  it('12 - createNode válido task con status', () => {
    const result = createNodeSchema.safeParse({
      type: 'task',
      title: 'Mi tarea',
      status: 'todo',
    })
    expect(result.success).toBe(true)
  })

  it('13 - createNode válido note sin status', () => {
    const result = createNodeSchema.safeParse({
      type: 'note',
      title: 'Nota',
    })
    expect(result.success).toBe(true)
  })

  it('14 - tipo inválido', () => {
    const result = createNodeSchema.safeParse({
      type: 'invalid',
      title: 'Titulo',
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0].message).toMatch(/Tipo/)
  })

  it('15 - falta título', () => {
    const result = createNodeSchema.safeParse({
      type: 'task',
      title: '',
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0].message).toMatch(/título/i)
  })

  it('16 - título muy largo', () => {
    const result = createNodeSchema.safeParse({
      type: 'task',
      title: 'A'.repeat(201),
    })
    expect(result.success).toBe(false)
  })

  it('17 - status en note debe fallar', () => {
    const result = createNodeSchema.safeParse({
      type: 'note',
      title: 'Nota',
      status: 'todo',
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0].message).toMatch(/Solo los nodos de tipo task/)
  })

  it('18 - status en idea debe fallar', () => {
    const result = createNodeSchema.safeParse({
      type: 'idea',
      title: 'Idea',
      status: 'done',
    })
    expect(result.success).toBe(false)
  })

  it('19 - contenido muy largo', () => {
    const result = createNodeSchema.safeParse({
      type: 'note',
      title: 'Nota',
      content: 'a'.repeat(5001),
    })
    expect(result.success).toBe(false)
  })

  it('20 - válido con posición', () => {
    const result = createNodeSchema.safeParse({
      type: 'project',
      title: 'Proyecto',
      positionX: 100,
      positionY: 200,
    })
    expect(result.success).toBe(true)
  })

  it('21 - posición NaN debe fallar', () => {
    const result = createNodeSchema.safeParse({
      type: 'project',
      title: 'Proyecto',
      positionX: NaN,
    })
    expect(result.success).toBe(false)
  })

  it('22 - updateNode válido parcial', () => {
    const result = updateNodeSchema.safeParse({
      title: 'Nuevo título',
    })
    expect(result.success).toBe(true)
  })

  it('23 - updateNode tipo inválido', () => {
    const result = updateNodeSchema.safeParse({
      type: 'bad',
    })
    expect(result.success).toBe(false)
  })

  it('24 - updateNode status con type task debe pasar', () => {
    const result = updateNodeSchema.safeParse({
      type: 'task',
      status: 'in_progress',
    })
    expect(result.success).toBe(true)
  })

  it('25 - updateNode status con type note debe fallar', () => {
    const result = updateNodeSchema.safeParse({
      type: 'note',
      status: 'todo',
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0].message).toMatch(/Solo los nodos de tipo task/)
  })

  it('26 - updateNode título vacío debe fallar', () => {
    const result = updateNodeSchema.safeParse({
      title: '',
    })
    expect(result.success).toBe(false)
  })
})

// ============================================================
// EDGE
// ============================================================

describe('edge validators', () => {
  it('27 - createEdge válido related_to', () => {
    const result = createEdgeSchema.safeParse({
      sourceId: 'id1',
      targetId: 'id2',
      type: 'related_to',
    })
    expect(result.success).toBe(true)
  })

  it('28 - createEdge válido depends_on', () => {
    const result = createEdgeSchema.safeParse({
      sourceId: 'id1',
      targetId: 'id2',
      type: 'depends_on',
      label: 'bloquea',
    })
    expect(result.success).toBe(true)
  })

  it('29 - falta sourceId', () => {
    const result = createEdgeSchema.safeParse({
      sourceId: '',
      targetId: 'id2',
      type: 'related_to',
    })
    expect(result.success).toBe(false)
  })

  it('30 - falta targetId', () => {
    const result = createEdgeSchema.safeParse({
      sourceId: 'id1',
      targetId: '',
      type: 'related_to',
    })
    expect(result.success).toBe(false)
  })

  it('31 - tipo inválido', () => {
    const result = createEdgeSchema.safeParse({
      sourceId: 'id1',
      targetId: 'id2',
      type: 'bad_type',
    })
    expect(result.success).toBe(false)
  })

  it('32 - self-loop debe fallar', () => {
    const result = createEdgeSchema.safeParse({
      sourceId: 'same',
      targetId: 'same',
      type: 'related_to',
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0].message).toMatch(/no puede conectarse a sí mismo/)
  })

  it('33 - label muy largo', () => {
    const result = createEdgeSchema.safeParse({
      sourceId: 'id1',
      targetId: 'id2',
      type: 'related_to',
      label: 'a'.repeat(201),
    })
    expect(result.success).toBe(false)
  })

  it('34 - válido con label', () => {
    const result = createEdgeSchema.safeParse({
      sourceId: 'id1',
      targetId: 'id2',
      type: 'parent_of',
      label: 'hijo',
    })
    expect(result.success).toBe(true)
  })

  it('35 - updateEdge válido label', () => {
    const result = updateEdgeSchema.safeParse({
      label: 'nuevo label',
    })
    expect(result.success).toBe(true)
  })

  it('36 - updateEdge self-loop debe fallar', () => {
    const result = updateEdgeSchema.safeParse({
      sourceId: 'same',
      targetId: 'same',
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0].message).toMatch(/no puede conectarse a sí mismo/)
  })

  it('37 - updateEdge tipo inválido', () => {
    const result = updateEdgeSchema.safeParse({
      type: 'bad',
    })
    expect(result.success).toBe(false)
  })
})

// ============================================================
// WORKSPACE
// ============================================================

describe('workspace validators', () => {
  it('38 - createWorkspace válido', () => {
    const result = createWorkspaceSchema.safeParse({
      name: 'Mi Workspace',
      slug: 'mi-workspace',
    })
    expect(result.success).toBe(true)
  })

  it('39 - slug mayúsculas debe fallar', () => {
    const result = createWorkspaceSchema.safeParse({
      name: 'Test',
      slug: 'Mi-Workspace',
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0].message).toMatch(/slug/)
  })

  it('40 - slug con guión inicial debe fallar', () => {
    const result = createWorkspaceSchema.safeParse({
      name: 'Test',
      slug: '-mi-slug',
    })
    expect(result.success).toBe(false)
  })

  it('41 - slug con guión final debe fallar', () => {
    const result = createWorkspaceSchema.safeParse({
      name: 'Test',
      slug: 'mi-slug-',
    })
    expect(result.success).toBe(false)
  })

  it('42 - slug muy corto', () => {
    const result = createWorkspaceSchema.safeParse({
      name: 'Test',
      slug: 'ab',
    })
    expect(result.success).toBe(false)
  })

  it('43 - slug muy largo', () => {
    const result = createWorkspaceSchema.safeParse({
      name: 'Test',
      slug: 'a'.repeat(51),
    })
    expect(result.success).toBe(false)
  })

  it('44 - nombre muy corto', () => {
    const result = createWorkspaceSchema.safeParse({
      name: 'A',
      slug: 'mi-slug',
    })
    expect(result.success).toBe(false)
  })

  it('45 - nombre muy largo', () => {
    const result = createWorkspaceSchema.safeParse({
      name: 'A'.repeat(101),
      slug: 'mi-slug',
    })
    expect(result.success).toBe(false)
  })

  it('46 - slug con espacios debe fallar', () => {
    const result = createWorkspaceSchema.safeParse({
      name: 'Test',
      slug: 'mi slug',
    })
    expect(result.success).toBe(false)
  })

  it('47 - slug con guión bajo debe fallar', () => {
    const result = createWorkspaceSchema.safeParse({
      name: 'Test',
      slug: 'mi_slug',
    })
    expect(result.success).toBe(false)
  })

  it('48 - updateWorkspace válido parcial', () => {
    const result = updateWorkspaceSchema.safeParse({
      name: 'Nuevo nombre',
    })
    expect(result.success).toBe(true)
  })

  it('49 - updateWorkspace slug inválido', () => {
    const result = updateWorkspaceSchema.safeParse({
      slug: 'INVALIDO',
    })
    expect(result.success).toBe(false)
  })
})
