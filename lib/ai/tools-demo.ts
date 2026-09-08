import { tool } from 'ai'
import { z } from 'zod'
import type { DemoGraph } from '@/lib/demo/graph-ops'
import {
  createNode,
  updateNode,
  deleteNode,
  createEdge,
  deleteEdge,
  queryGraph,
} from '@/lib/demo/graph-ops'
import { serializeNode, serializeEdge } from '@/lib/ai/serialize'

// ============================================================
// Tools del chat DEMO (F4.1b)
//
// Mismos nombres e inputSchema que buildTools de producción
// (lib/ai/tools.ts) para que el modelo se comporte igual; la
// implementación execute opera sobre el DemoGraph en memoria
// (lib/demo/graph-ops.ts), NUNCA sobre canvas-service/DB.
// ============================================================

export function buildDemoTools(ctx: { graph: DemoGraph }) {
  return {
    createNode: tool({
      description:
        'Crea un nodo nuevo en el canvas. Tipos válidos: project, task, note, idea, person, resource. Solo tasks pueden tener status (todo, in_progress, done). La posición en el canvas la asigna el sistema automáticamente. Opcionalmente fija dueDate (epoch ms) y reminderOffsetMin (minutos ANTES de la fecha límite; si fijas dueDate sin offset se usa 15).',
      inputSchema: z.object({
        type: z.enum(['project', 'task', 'note', 'idea', 'person', 'resource']),
        title: z.string().min(1).max(200),
        content: z.string().max(5000).optional().nullable(),
        status: z.enum(['todo', 'in_progress', 'done']).optional().nullable(),
        dueDate: z.number().int().optional().nullable(),
        reminderOffsetMin: z.number().int().min(0).optional().nullable(),
      }),
      execute: async (input) => serializeNode(createNode(ctx.graph, input)),
    }),

    updateNode: tool({
      description:
        'Actualiza un nodo existente por ID (título, contenido, tipo, estado, dueDate o reminderOffsetMin; nunca la posición)',
      inputSchema: z.object({
        nodeId: z.string().min(1),
        type: z.enum(['project', 'task', 'note', 'idea', 'person', 'resource']).optional(),
        title: z.string().min(1).max(200).optional(),
        content: z.string().max(5000).optional().nullable(),
        status: z.enum(['todo', 'in_progress', 'done']).optional().nullable(),
        dueDate: z.number().int().optional().nullable(),
        reminderOffsetMin: z.number().int().min(0).optional().nullable(),
      }),
      execute: async ({ nodeId, ...rest }) =>
        serializeNode(updateNode(ctx.graph, nodeId, rest)),
    }),

    deleteNode: tool({
      description: 'Borra suavemente un nodo por ID (soft delete)',
      inputSchema: z.object({
        nodeId: z.string().min(1),
      }),
      execute: async ({ nodeId }) => deleteNode(ctx.graph, nodeId),
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
      execute: async (input) => serializeEdge(createEdge(ctx.graph, input)),
    }),

    deleteEdge: tool({
      description: 'Borra una conexión por ID',
      inputSchema: z.object({
        edgeId: z.string().min(1),
      }),
      execute: async ({ edgeId }) => deleteEdge(ctx.graph, edgeId),
    }),

    queryGraph: tool({
      description:
        'Consulta el grafo completo del workspace. Retorna todos los nodos y edges activos. Usa esto para entender la estructura antes de crear/modificar.',
      inputSchema: z.object({}),
      execute: async () => {
        const graph = queryGraph(ctx.graph)
        return {
          nodes: graph.nodes.map(serializeNode),
          edges: graph.edges.map(serializeEdge),
          summary: `${graph.nodes.length} nodos, ${graph.edges.length} conexiones`,
        }
      },
    }),
  }
}