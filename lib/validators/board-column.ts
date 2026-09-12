import { z } from 'zod'

export const BOARD_COLUMN_TITLE_MAX = 100

export const createBoardColumnSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'El título es requerido')
    .max(BOARD_COLUMN_TITLE_MAX, 'El título no puede exceder 100 caracteres'),
  position: z.number().finite('La posición debe ser un número válido').optional(),
})

export const updateBoardColumnSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'El título es requerido')
      .max(BOARD_COLUMN_TITLE_MAX, 'El título no puede exceder 100 caracteres')
      .optional(),
    position: z.number().finite('La posición debe ser un número válido').optional(),
  })
  .refine((data) => data.title !== undefined || data.position !== undefined, {
    message: 'Debe proporcionar al menos un campo (title, position)',
  })

export const deleteBoardColumnSchema = z.object({
  rehomeTo: z.string().trim().min(1).max(100).optional().nullable(),
})

export const moveBoardTaskSchema = z.object({
  nodeId: z.string().trim().min(1, 'nodeId es requerido').max(100),
  toColumnId: z.string().trim().min(1, 'toColumnId es requerido').max(100),
  toOrder: z.number().finite('toOrder debe ser un número válido').optional(),
})

export type CreateBoardColumnInput = z.infer<typeof createBoardColumnSchema>
export type UpdateBoardColumnInput = z.infer<typeof updateBoardColumnSchema>
export type MoveBoardTaskInput = z.infer<typeof moveBoardTaskSchema>
