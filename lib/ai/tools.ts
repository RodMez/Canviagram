import { tool } from 'ai'
import { z } from 'zod'
import { eq, and, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import * as canvasService from '@/lib/canvas-service'
import { serializeNode, serializeEdge } from '@/lib/ai/serialize'
import { NODE_TYPES, NODE_PRIORITIES, RECURRENCE_RULES, users, workspaces, workspaceMembers } from '@/lib/db/schema'
import { createWorkspace as createWorkspaceService, updateWorkspace as updateWorkspaceService } from '@/lib/workspace-admin'
import { listWorkspacesForUser } from '@/lib/canvas/workspace-by-slug'
import { matchWorkspace, type WorkspaceListItem } from '@/lib/workspace/switch'

// Nota: el SDK ai v7 usa `inputSchema` (no `parameters` como en v4).
// El diseño 1.2 usa `parameters`; se adapta a `inputSchema` para v7.

export type ToolContext = {
  workspaceId: string
  userId: string
}

function normalizeMemberName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Resuelve un nombre de miembro a userId (para que la IA administre el
 * responsable por nombre). Busca en owner + miembros por displayName o email.
 * - 1 match exacto (o único parcial) → userId.
 * - 0 o N → lanza Error con candidatos para que la IA pregunte/clarique.
 */
export async function resolveMemberIdByName(workspaceId: string, rawName: string): Promise<string> {
  const q = normalizeMemberName(rawName)
  if (!q) throw new Error('Nombre de responsable vacío')
  const ws = await db.select({ ownerId: workspaces.ownerId }).from(workspaces).where(eq(workspaces.id, workspaceId)).get()
  if (!ws) throw new Error('Workspace no encontrado')
  const ownerRow = await db
    .select({ id: users.id, displayName: users.displayName, email: users.email })
    .from(users)
    .where(eq(users.id, ws.ownerId))
    .get()
  const memberRows = await db
    .select({ userId: workspaceMembers.userId, displayName: users.displayName, email: users.email })
    .from(workspaceMembers)
    .leftJoin(users, and(eq(workspaceMembers.userId, users.id), isNull(users.deletedAt)))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .all()
  const candidates = [
    ...(ownerRow ? [{ userId: ownerRow.id, displayName: ownerRow.displayName ?? '', email: ownerRow.email ?? '' }] : []),
    ...memberRows.map((m) => ({ userId: m.userId, displayName: m.displayName ?? '', email: m.email ?? '' })),
  ].filter((c, i, arr) => arr.findIndex((x) => x.userId === c.userId) === i)
  const exact = candidates.filter(
    (c) => normalizeMemberName(c.displayName) === q || c.email.toLowerCase() === q
  )
  if (exact.length === 1) return exact[0]!.userId
  if (exact.length > 1) {
    throw new Error(`Varios miembros coinciden con «${rawName}»: ${exact.map((c) => c.displayName).join(', ')}. Pide aclaración.`)
  }
  const partial = candidates.filter(
    (c) => normalizeMemberName(c.displayName).includes(q) || c.email.toLowerCase().includes(q)
  )
  if (partial.length === 1) return partial[0]!.userId
  if (partial.length > 1) {
    throw new Error(`Varios miembros coinciden con «${rawName}»: ${partial.map((c) => c.displayName).join(', ')}. Pide aclaración.`)
  }
  throw new Error(
    `Ningún miembro coincide con «${rawName}». Miembros: ${candidates.map((c) => c.displayName).join(', ') || '(sin miembros)'}`
  )
}

const taskAdminFields = {
  priority: z.enum(NODE_PRIORITIES).optional().nullable(),
  effort: z.number().int().min(0).max(100).optional().nullable(),
  assigneeId: z.string().min(1).max(100).optional().nullable(),
  assigneeName: z.string().min(1).max(100).optional().nullable(),
}

const personLinkFields = {
  linkedUserId: z.string().min(1).max(100).optional().nullable(),
  linkedUserName: z.string().min(1).max(100).optional().nullable(),
}

async function resolveAssigneeInput(input: { assigneeId?: string | null; assigneeName?: string | null }, workspaceId: string) {
  let assigneeId = input.assigneeId ?? null
  if (!assigneeId && input.assigneeName) {
    assigneeId = await resolveMemberIdByName(workspaceId, input.assigneeName)
  }
  return assigneeId
}

async function resolveLinkedUserInput(input: { linkedUserId?: string | null; linkedUserName?: string | null }, workspaceId: string) {
  let linkedUserId = input.linkedUserId ?? null
  if (!linkedUserId && input.linkedUserName) {
    linkedUserId = await resolveMemberIdByName(workspaceId, input.linkedUserName)
  }
  return linkedUserId
}

/**
 * Resuelve el workspace sobre el que actuar una tool de workspace.
 * - Sin workspaceQuery → el actual/activo (ctx.workspaceId).
 * - Con query → fuzzy por nombre/slug; 1 match OK, 0/N → Error con candidatos
 *   (el LLM pedirá aclaración o usará listWorkspaces).
 */
async function resolveTargetWorkspaceId(
  userId: string,
  workspaceQuery: string | undefined,
  currentWorkspaceId: string
): Promise<string> {
  if (!workspaceQuery) return currentWorkspaceId
  const all = (await listWorkspacesForUser(userId)) as WorkspaceListItem[]
  const matches = matchWorkspace(workspaceQuery, all)
  if (matches.length === 1) return matches[0]!.id
  if (matches.length > 1) {
    throw new Error(
      `Varios workspaces coinciden con «${workspaceQuery}»: ${matches.map((w) => w.name).join(', ')}. Pide aclaración.`
    )
  }
  throw new Error(
    `Ningún workspace coincide con «${workspaceQuery}». Workspaces del usuario: ${all.map((w) => w.name).join(', ') || '(ninguno)'}`
  )
}

// Factory: construye 7 tools con contexto de workspace.
// Errores de canvas-service se propagan; el SDK ai los captura como
// tool-result con isError:true (sin try/catch en execute).
export function buildTools(ctx: ToolContext) {
  return {
    createNode: tool({
      description:
        'Crea un nodo nuevo en el canvas. Tipos válidos: task, note, idea, person, resource. Solo tasks pueden tener status (todo, in_progress, done), priority (urgent, high, medium, low), effort (0-100) y responsable (assigneeId o assigneeName por nombre del miembro). Solo person puede tener linkedUserId/linkedUserName (vincula a un usuario del workspace; null = nombre libre). La posición la asigna el sistema. Opcionalmente fija dueDate (epoch ms) y reminderOffsetMin. recurrenceRule requiere dueDate.',
      inputSchema: z.object({
        type: z.enum(NODE_TYPES),
        title: z.string().min(1).max(200),
        content: z.string().max(5000).optional().nullable(),
        status: z.enum(['todo', 'in_progress', 'done']).optional().nullable(),
        ...taskAdminFields,
        ...personLinkFields,
        dueDate: z.number().int().optional().nullable(),
        reminderOffsetMin: z.number().int().min(0).optional().nullable(),
        recurrenceRule: z.enum(RECURRENCE_RULES).optional().nullable(),
      }),
      execute: async (input) => {
        const assigneeId = await resolveAssigneeInput(input, ctx.workspaceId)
        const linkedUserId = await resolveLinkedUserInput(input, ctx.workspaceId)
        const { assigneeName, linkedUserName, ...rest } = input
        const node = await canvasService.createNode(ctx.workspaceId, ctx.userId, {
          ...rest,
          assigneeId,
          linkedUserId,
        })
        return serializeNode(node)
      },
    }),

    updateNode: tool({
      description:
        'Actualiza un nodo existente por ID (título, contenido, tipo, estado, priority, effort, responsable por ID o nombre, vínculo person, dueDate, reminderOffsetMin o recurrenceRule; nunca la posición). Solo task admite priority/effort/responsable; solo person admite vínculo. recurrenceRule requiere dueDate.',
      inputSchema: z.object({
        nodeId: z.string().min(1),
        type: z.enum(NODE_TYPES).optional(),
        title: z.string().min(1).max(200).optional(),
        content: z.string().max(5000).optional().nullable(),
        status: z.enum(['todo', 'in_progress', 'done']).optional().nullable(),
        ...taskAdminFields,
        ...personLinkFields,
        dueDate: z.number().int().optional().nullable(),
        reminderOffsetMin: z.number().int().min(0).optional().nullable(),
        recurrenceRule: z.enum(RECURRENCE_RULES).optional().nullable(),
      }),
      execute: async ({ nodeId, ...rest }) => {
        const assigneeId =
          rest.assigneeId !== undefined || rest.assigneeName
            ? await resolveAssigneeInput(rest, ctx.workspaceId)
            : undefined
        const linkedUserId =
          rest.linkedUserId !== undefined || rest.linkedUserName
            ? await resolveLinkedUserInput(rest, ctx.workspaceId)
            : undefined
        const { assigneeName, linkedUserName, ...payload } = rest
        const node = await canvasService.updateNode(ctx.workspaceId, nodeId, ctx.userId, {
          ...payload,
          ...(assigneeId !== undefined ? { assigneeId } : {}),
          ...(linkedUserId !== undefined ? { linkedUserId } : {}),
        })
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
        'Consulta el grafo completo del workspace. Retorna todos los nodos (con status, priority, effort, assigneeId, vínculo person) y edges activos. Usa esto para entender la estructura antes de crear/modificar.',
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

    listMembers: tool({
      description:
        'Lista los usuarios del workspace (displayName + email) para resolver el responsable por nombre. Úsala antes de asignar si no conoces el nombre exacto.',
      inputSchema: z.object({}),
      execute: async () => {
        const ws = await db.select({ ownerId: workspaces.ownerId }).from(workspaces).where(eq(workspaces.id, ctx.workspaceId)).get()
        if (!ws) return { members: [] }
        const ownerRow = await db
          .select({ id: users.id, displayName: users.displayName, email: users.email })
          .from(users)
          .where(eq(users.id, ws.ownerId))
          .get()
        const memberRows = await db
          .select({ userId: workspaceMembers.userId, displayName: users.displayName, email: users.email })
          .from(workspaceMembers)
          .leftJoin(users, and(eq(workspaceMembers.userId, users.id), isNull(users.deletedAt)))
          .where(eq(workspaceMembers.workspaceId, ctx.workspaceId))
          .all()
        const members = [
          ...(ownerRow ? [{ userId: ownerRow.id, displayName: ownerRow.displayName, email: ownerRow.email }] : []),
          ...memberRows,
        ]
        return { members }
      },
    }),

    layoutGraph: tool({
      description:
        'Reorganiza automáticamente TODOS los nodos del workspace en un layout jerárquico ' +
        'según sus conexiones (depends_on, parent_of quedan arriba→abajo). Úsala después de ' +
        'crear o conectar varios nodos, o cuando el usuario pida "organiza esto"/"ordena el canvas". ' +
        'No requiere parámetros. Afecta a TODOS los nodos del workspace, no solo a los que acabas de tocar.',
      inputSchema: z.object({}),
      execute: async () => {
        const result = await canvasService.relayoutWorkspace(ctx.workspaceId, ctx.userId)
        return { repositioned: result.repositioned }
      },
    }),

    createWorkspace: tool({
      description:
        'Crea un workspace nuevo para el usuario. El slug se autogenera desde el nombre. ' +
        'Devuelve el workspace creado (id, name, slug) para que el sistema lo active/navegue.',
      inputSchema: z.object({
        name: z.string().trim().min(2).max(100),
      }),
      execute: async ({ name }) => {
        const { workspace } = await createWorkspaceService(ctx.userId, { name })
        return {
          workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
        }
      },
    }),

    renameWorkspace: tool({
      description:
        'Renombra un workspace (solo el nombre; el slug nunca cambia). Por defecto aplica al ' +
        'workspace actual/activo; con workspaceQuery resuelve otro por nombre o slug aproximado.',
      inputSchema: z.object({
        name: z.string().trim().min(2).max(100),
        workspaceQuery: z.string().min(1).max(100).optional(),
      }),
      execute: async ({ name, workspaceQuery }) => {
        const targetId = await resolveTargetWorkspaceId(ctx.userId, workspaceQuery, ctx.workspaceId)
        const { workspace } = await updateWorkspaceService(targetId, ctx.userId, { name })
        return {
          workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
        }
      },
    }),

    listWorkspaces: tool({
      description:
        'Lista los workspaces del usuario (id, name, slug). Úsala para resolver por nombre ' +
        'a cuál cambiar/renombrar o confirmar los disponibles.',
      inputSchema: z.object({}),
      execute: async () => {
        const list = await listWorkspacesForUser(ctx.userId)
        return { workspaces: list.map((w) => ({ id: w.id, name: w.name, slug: w.slug })) }
      },
    }),

    switchWorkspace: tool({
      description:
        'Cambia el workspace activo a «workspaceQuery» (nombre o slug aproximado). ' +
        'Resuelve y devuelve el workspace destino; el sistema aplica el cambio y redirige. ' +
        'Si el nombre es ambiguo o no existe, devuelve error para pedir aclaración.',
      inputSchema: z.object({
        workspaceQuery: z.string().min(1).max(100),
      }),
      execute: async ({ workspaceQuery }) => {
        const all = (await listWorkspacesForUser(ctx.userId)) as WorkspaceListItem[]
        const matches = matchWorkspace(workspaceQuery, all)
        if (matches.length === 1) {
          return {
            workspace: { id: matches[0]!.id, name: matches[0]!.name, slug: matches[0]!.slug },
          }
        }
        if (matches.length > 1) {
          throw new Error(
            `Varios workspaces coinciden con «${workspaceQuery}»: ${matches.map((w) => w.name).join(', ')}. Pide aclaración.`
          )
        }
        throw new Error(
          `Ningún workspace coincide con «${workspaceQuery}». Workspaces del usuario: ${all.map((w) => w.name).join(', ') || '(ninguno)'}`
        )
      },
    }),
  }
}

export { serializeNode, serializeEdge }
