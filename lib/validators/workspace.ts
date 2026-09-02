import { z } from 'zod'

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const createWorkspaceSchema = z.object({
  name: z
    .string()
    .min(2, 'El nombre debe tener al menos 2 caracteres')
    .max(100, 'El nombre no puede exceder 100 caracteres')
    .trim(),
  slug: z
    .string()
    .min(3, 'El slug debe tener al menos 3 caracteres')
    .max(50, 'El slug no puede exceder 50 caracteres')
    .regex(slugRegex, 'El slug solo puede contener letras minúsculas, números y guiones, y no puede empezar ni terminar con guión')
    .trim(),
})

export const updateWorkspaceSchema = z.object({
  name: z
    .string()
    .min(2, 'El nombre debe tener al menos 2 caracteres')
    .max(100, 'El nombre no puede exceder 100 caracteres')
    .trim()
    .optional(),
  slug: z
    .string()
    .min(3, 'El slug debe tener al menos 3 caracteres')
    .max(50, 'El slug no puede exceder 50 caracteres')
    .regex(slugRegex, 'El slug solo puede contener letras minúsculas, números y guiones, y no puede empezar ni terminar con guión')
    .trim()
    .optional(),
})

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>
