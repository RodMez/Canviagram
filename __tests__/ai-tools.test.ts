import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/canvas-service', () => ({
  createNode: vi.fn(),
  updateNode: vi.fn(),
  softDeleteNode: vi.fn(),
  createEdge: vi.fn(),
  deleteEdge: vi.fn(),
  getWorkspaceGraph: vi.fn(),
  relayoutWorkspace: vi.fn(),
}))

import * as canvasService from '@/lib/canvas-service'
import { buildTools, serializeNode, serializeEdge } from '@/lib/ai/tools'

const cs = vi.mocked(canvasService)
const ctx = { workspaceId: 'ws-1', userId: 'user-1' }
const opts = { toolCallId: 'call-1', messages: [], context: {} }

describe('AI tools', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('serializeNode/Edge extraen solo campos relevantes', () => {
    const node = serializeNode({ id: 'n1', type: 'task', title: 'T', content: 'c', status: 'todo', positionX: 10, positionY: 20, workspaceId: 'ws-1', createdAt: new Date() })
    expect(node).toEqual({ id: 'n1', type: 'task', title: 'T', content: 'c', status: 'todo', positionX: 10, positionY: 20, dueDate: null, reminderOffsetMin: null })
    expect(node).not.toHaveProperty('workspaceId')
    const edge = serializeEdge({ id: 'e1', sourceId: 'n1', targetId: 'n2', type: 'related_to', label: 'test', workspaceId: 'ws-1', createdAt: new Date() })
    expect(edge).toEqual({ id: 'e1', sourceId: 'n1', targetId: 'n2', type: 'related_to', label: 'test' })
    expect(edge).not.toHaveProperty('workspaceId')
  })

  it('createNode llama canvasService.createNode con args correctos', async () => {
    cs.createNode.mockResolvedValue({ id: 'n1', type: 'task', title: 'Hacer deploy', content: null, status: 'todo', positionX: 0, positionY: 0 } as any)
    const result = await buildTools(ctx).createNode.execute!({ type: 'task', title: 'Hacer deploy', status: 'todo' }, opts)
    expect(cs.createNode).toHaveBeenCalledWith('ws-1', 'user-1', { type: 'task', title: 'Hacer deploy', status: 'todo' })
    expect(result).toHaveProperty('id', 'n1')
  })

  it('updateNode separa nodeId del resto', async () => {
    cs.updateNode.mockResolvedValue({ id: 'n1', type: 'task', title: 'Updated', content: null, status: 'done', positionX: 0, positionY: 0 } as any)
    const result = await buildTools(ctx).updateNode.execute!({ nodeId: 'n1', title: 'Updated', status: 'done' }, opts)
    expect(cs.updateNode).toHaveBeenCalledWith('ws-1', 'n1', 'user-1', { title: 'Updated', status: 'done' })
    expect(result).toHaveProperty('id', 'n1')
  })

  it('deleteNode llama softDeleteNode y retorna success', async () => {
    cs.softDeleteNode.mockResolvedValue(undefined as any)
    const result = await buildTools(ctx).deleteNode.execute!({ nodeId: 'n1' }, opts)
    expect(cs.softDeleteNode).toHaveBeenCalledWith('ws-1', 'n1', 'user-1')
    expect(result).toEqual({ success: true, nodeId: 'n1' })
  })

  it('createEdge llama canvasService.createEdge con args correctos', async () => {
    cs.createEdge.mockResolvedValue({ id: 'e1', sourceId: 'n1', targetId: 'n2', type: 'depends_on', label: null } as any)
    const result = await buildTools(ctx).createEdge.execute!({ sourceId: 'n1', targetId: 'n2', type: 'depends_on' }, opts)
    expect(cs.createEdge).toHaveBeenCalledWith('ws-1', 'user-1', { sourceId: 'n1', targetId: 'n2', type: 'depends_on' })
    expect(result).toHaveProperty('id', 'e1')
  })

  it('deleteEdge llama canvasService.deleteEdge y retorna success', async () => {
    cs.deleteEdge.mockResolvedValue(undefined as any)
    const result = await buildTools(ctx).deleteEdge.execute!({ edgeId: 'e1' }, opts)
    expect(cs.deleteEdge).toHaveBeenCalledWith('ws-1', 'e1', 'user-1')
    expect(result).toEqual({ success: true, edgeId: 'e1' })
  })

  it('queryGraph retorna nodos y edges serializados con summary', async () => {
    cs.getWorkspaceGraph.mockResolvedValue({
      nodes: [
        { id: 'n1', type: 'task', title: 'T1', content: null, status: 'todo', positionX: 0, positionY: 0 },
        { id: 'n2', type: 'note', title: 'N1', content: 'Hello', status: null, positionX: 10, positionY: 20 },
      ],
      edges: [{ id: 'e1', sourceId: 'n1', targetId: 'n2', type: 'related_to', label: null }],
    } as any)
    const result = await buildTools(ctx).queryGraph.execute!({}, opts)
    expect(cs.getWorkspaceGraph).toHaveBeenCalledWith('ws-1', 'user-1')
    expect(result).toHaveProperty('summary', '2 nodos, 1 conexiones')
    expect((result as any).nodes).toHaveLength(2)
    expect((result as any).edges).toHaveLength(1)
  })

  it('layoutGraph llama relayoutWorkspace y retorna repositioned', async () => {
    cs.relayoutWorkspace.mockResolvedValue({ repositioned: 5 } as any)
    const result = await buildTools(ctx).layoutGraph.execute!({}, opts)
    expect(cs.relayoutWorkspace).toHaveBeenCalledWith('ws-1', 'user-1')
    expect(result).toEqual({ repositioned: 5 })
  })

  it('createNode propaga errores de canvas-service sin catch', async () => {
    const error = new Error('Validation failed')
    error.name = 'ValidationError'
    cs.createNode.mockRejectedValue(error)
    await expect(buildTools(ctx).createNode.execute!({ type: 'task', title: 'Test' }, opts)).rejects.toThrow('Validation failed')
  })
})
