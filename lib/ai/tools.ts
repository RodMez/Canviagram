import { tool } from 'ai'
import { z } from 'zod'
import * as canvasService from '@/lib/canvas-service'
import { serializeNode, serializeEdge } from '@/lib/ai/serialize'

// Nota: el SDK ai v7 usa `inputSchema` (no `parameters` como en v4).
// El diseño 1.2 usa `parameters`; se adapta a `inputSchema` para v7.

export type ToolContext = {
  workspaceId: string
  userId: string
}

// Factory: construye 6 tools con contexto de workspace.
// Errores de canvas-service se propagan; el SDK ai los captura como
// tool-result con isError:true (sin try/catch en execute).
export function buildTools(ctx: ToolContext) {
  return {
    createNode: tool({
      description:
        'Crea un nodo nuevo en el canvas. Tipos válidos: project, task, note, idea, person, resource. Solo tasks pueden tener status (todo, in_progress, done).',
      inputSchema: z.object({
        type: z.enum(['project', 'task', 'note', 'idea', 'person', 'resource']),
        title: z.string().min(1).max(200),
        content: z.string().max(5000).optional().nullable(),
        status: z.enum(['todo', 'in_progress', 'done']).optional().nullable(),
        positionX: z.number().finite().optional(),
        positionY: z.number().finite().optional(),
      }),
      execute: async (input) => {
        const node = await canvasService.createNode(ctx.workspaceId, ctx.userId, input)
        return serializeNode(node)
      },
    }),

    updateNode: tool({
      description: 'Actualiza un nodo existente por ID',
      inputSchema: z.object({
        nodeId: z.string().min(1),
        type: z.enum(['project', 'task', 'note', 'idea', 'person', 'resource']).optional(),
        title: z.string().min(1).max(200).optional(),
        content: z.string().max(5000).optional().nullable(),
        status: z.enum(['todo', 'in_progress', 'done']).optional().nullable(),
        positionX: z.number().finite().optional(),
        positionY: z.number().finite().optional(),
      }),
      execute: async ({ nodeId, ...rest }) => {
        const node = await canvasService.updateNode(ctx.workspaceId, nodeId, ctx.userId, rest)
        return serializeNode(node)
      },
    }),

    deleteNode: tool({
      description: 'Borra suavemente un nodo por ID (soft delete)',
      inputSchema: z.object({
        nodeId: z.string().min(1),
      }),
      execute: async ({ nodeId }) => {
        await canvasService.softDeleteNode(ctx.workspaceId, nodeId, ctx.userId)
        return { success: true, nodeId }
      },
    }),

    createEdge: tool({
      description:
        'Crea una conexión entre dos nodos. sourceId y targetId deben ser IDs de nodos existentes.',
      inputSchema: z.object({
        sourceId: z.string().min(1),
        targetId: z.string().min(1),
        type: z.enum(['depends_on', 'parent_of', 'related_to']),
        label: z.string().max(200).optional().nullable(),
      }),
      execute: async (input) => {
        const edge = await canvasService.createEdge(ctx.workspaceId, ctx.userId, input)
        return serializeEdge(edge)
      },
    }),

    deleteEdge: tool({
      description: 'Borra una conexión por ID',
      inputSchema: z.object({
        edgeId: z.string().min(1),
      }),
      execute: async ({ edgeId }) => {
        await canvasService.deleteEdge(ctx.workspaceId, edgeId, ctx.userId)
        return { success: true, edgeId }
      },
    }),

    queryGraph: tool({
      description:
        'Consulta el grafo completo del workspace. Retorna todos los nodos y edges activos. Usa esto para entender la estructura antes de crear/modificar.',
      inputSchema: z.object({}),
      execute: async () => {
        const graph = await canvasService.getWorkspaceGraph(ctx.workspaceId, ctx.userId)
        return {
          nodes: graph.nodes.map(serializeNode),
          edges: graph.edges.map(serializeEdge),
          summary: `${graph.nodes.length} nodos, ${graph.edges.length} conexiones`,
        }
      },
    }),
  }
}

export { serializeNode, serializeEdge }
