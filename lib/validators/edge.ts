import { z } from 'zod'
import { EDGE_TYPES } from '@/lib/db/schema'

export const createEdgeSchema = z
  .object({
    sourceId: z.string().min(1, 'El ID de origen es requerido'),
    targetId: z.string().min(1, 'El ID de destino es requerido'),
    type: z.enum(EDGE_TYPES, {
      message: 'Tipo de conexión no válido',
    }),
    label: z.string().max(200, 'La etiqueta no puede exceder 200 caracteres').optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.sourceId === data.targetId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetId'],
        message: 'Un nodo no puede conectarse a sí mismo',
      })
    }
  })

export const updateEdgeSchema = z
  .object({
    type: z
      .enum(EDGE_TYPES, {
        message: 'Tipo de conexión no válido',
      })
      .optional(),
    label: z.string().max(200, 'La etiqueta no puede exceder 200 caracteres').optional().nullable(),
    sourceId: z.string().min(1, 'El ID de origen es requerido').optional(),
    targetId: z.string().min(1, 'El ID de destino es requerido').optional(),
  })
  .superRefine((data, ctx) => {
    if (data.sourceId && data.targetId && data.sourceId === data.targetId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetId'],
        message: 'Un nodo no puede conectarse a sí mismo',
      })
    }
  })

export type CreateEdgeInput = z.infer<typeof createEdgeSchema>
export type UpdateEdgeInput = z.infer<typeof updateEdgeSchema>
