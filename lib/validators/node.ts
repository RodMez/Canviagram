import { z } from 'zod'
import { NODE_TYPES, NODE_STATUSES, NODE_PRIORITIES, RECURRENCE_RULES } from '@/lib/db/schema'

const prioritySchema = z
  .enum(NODE_PRIORITIES, { message: 'Prioridad no válida' })
  .optional()
  .nullable()

const effortSchema = z
  .number()
  .int('El esfuerzo debe ser un entero')
  .min(0, 'El esfuerzo no puede ser negativo')
  .max(100, 'El esfuerzo no puede exceder 100')
  .optional()
  .nullable()

const assigneeIdSchema = z
  .string()
  .trim()
  .min(1, 'El responsable no es válido')
  .max(100, 'El responsable no es válido')
  .optional()
  .nullable()

const boardColumnIdSchema = z
  .string()
  .trim()
  .min(1, 'La columna no es válida')
  .max(100, 'La columna no es válida')
  .optional()
  .nullable()

function assertTaskOnly(
  data: {
    type?: string
    status?: string | null
    priority?: string | null
    effort?: number | null
    assigneeId?: string | null
    boardColumnId?: string | null
  },
  ctx: z.RefinementCtx
) {
  // Solo tasks pueden portar estos campos. En create, type siempre presente;
  // en update parcial, si type viene se valida contra él y el servicio
  // re-valida contra el tipo efectivo (existente) para cross-checks.
  if (data.type && data.type !== 'task') {
    for (const field of ['status', 'priority', 'effort', 'assigneeId', 'boardColumnId'] as const) {
      if (data[field] !== undefined && data[field] !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: 'Solo los nodos de tipo task pueden tener este campo',
        })
      }
    }
  }
}

export const createNodeSchema = z
  .object({
    type: z.enum(NODE_TYPES, {
      message: 'Tipo de nodo no válido',
    }),
    title: z
      .string()
      .trim()
      .min(1, 'El título es requerido')
      .max(200, 'El título no puede exceder 200 caracteres'),
    content: z
      .string()
      .trim()
      .max(5000, 'El contenido no puede exceder 5000 caracteres')
      .optional()
      .nullable(),
    status: z
      .enum(NODE_STATUSES, {
        message: 'Estado no válido',
      })
      .optional()
      .nullable(),
    positionX: z.number().finite('La posición X debe ser un número válido').optional(),
    positionY: z.number().finite('La posición Y debe ser un número válido').optional(),
    // Fase 3: recordatorio. dueDate = epoch ms; reminderOffsetMin = minutos ANTES de dueDate.
    dueDate: z
      .number()
      .int('La fecha límite debe ser un timestamp válido')
      .optional()
      .nullable(),
    reminderOffsetMin: z
      .number()
      .int('El recordatorio debe ser en minutos enteros')
      .min(0, 'El recordatorio no puede ser negativo')
      .max(525600, 'El recordatorio no puede exceder 1 año')
      .optional()
      .nullable(),
    recurrenceRule: z
      .enum(RECURRENCE_RULES, {
        message: 'Regla de recurrencia no válida',
      })
      .optional()
      .nullable(),
    priority: prioritySchema,
    effort: effortSchema,
    assigneeId: assigneeIdSchema,
    boardColumnId: boardColumnIdSchema,
  })
  .superRefine((data, ctx) => {
    if (data.status && data.type !== 'task') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['status'],
        message: 'Solo los nodos de tipo task pueden tener estado',
      })
    }
    assertTaskOnly(data, ctx)
    if (data.recurrenceRule && !data.dueDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recurrenceRule'],
        message: 'La recurrencia requiere una fecha límite (dueDate)',
      })
    }
  })

export const updateNodeSchema = z
  .object({
    type: z
      .enum(NODE_TYPES, {
        message: 'Tipo de nodo no válido',
      })
      .optional(),
    title: z
      .string()
      .trim()
      .min(1, 'El título es requerido')
      .max(200, 'El título no puede exceder 200 caracteres')
      .optional(),
    content: z
      .string()
      .trim()
      .max(5000, 'El contenido no puede exceder 5000 caracteres')
      .optional()
      .nullable(),
    status: z
      .enum(NODE_STATUSES, {
        message: 'Estado no válido',
      })
      .optional()
      .nullable(),
    positionX: z.number().finite('La posición X debe ser un número válido').optional(),
    positionY: z.number().finite('La posición Y debe ser un número válido').optional(),
    dueDate: z
      .number()
      .int('La fecha límite debe ser un timestamp válido')
      .optional()
      .nullable(),
    reminderOffsetMin: z
      .number()
      .int('El recordatorio debe ser en minutos enteros')
      .min(0, 'El recordatorio no puede ser negativo')
      .max(525600, 'El recordatorio no puede exceder 1 año')
      .optional()
      .nullable(),
    recurrenceRule: z
      .enum(RECURRENCE_RULES, {
        message: 'Regla de recurrencia no válida',
      })
      .optional()
      .nullable(),
    priority: prioritySchema,
    effort: effortSchema,
    assigneeId: assigneeIdSchema,
    boardColumnId: boardColumnIdSchema,
  })
  .superRefine((data, ctx) => {
    if (data.status && data.type && data.type !== 'task') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['status'],
        message: 'Solo los nodos de tipo task pueden tener estado',
      })
    }
    assertTaskOnly(data, ctx)
    if (data.recurrenceRule && !data.dueDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recurrenceRule'],
        message: 'La recurrencia requiere una fecha límite (dueDate)',
      })
    }
    if (data.status && !data.type) {
      // Si se intenta actualizar status sin conocer el tipo, permitimos pero el servicio
      // validará contra el tipo existente. Para validación pura de payload, si status viene sin type
      // no podemos decidir; el servicio hará la comprobación final.
      // No bloqueamos aquí para permitir PATCH parcial donde el nodo ya es task.
    }
  })

export type CreateNodeInput = z.infer<typeof createNodeSchema>
export type UpdateNodeInput = z.infer<typeof updateNodeSchema>
