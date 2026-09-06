import { z } from 'zod'
import { INVITATION_ROLES, WORKSPACE_ROLES } from '@/lib/db/schema'

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const createWorkspaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'El nombre debe tener al menos 2 caracteres')
    .max(100, 'El nombre no puede exceder 100 caracteres'),
  slug: z
    .string()
    .trim()
    .min(3, 'El slug debe tener al menos 3 caracteres')
    .max(50, 'El slug no puede exceder 50 caracteres')
    .regex(slugRegex, 'El slug solo puede contener letras minúsculas, números y guiones, y no puede empezar ni terminar con guión'),
})

export const updateWorkspaceSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'El nombre debe tener al menos 2 caracteres')
      .max(100, 'El nombre no puede exceder 100 caracteres')
      .optional(),
    slug: z
      .string()
      .trim()
      .min(3, 'El slug debe tener al menos 3 caracteres')
      .max(50, 'El slug no puede exceder 50 caracteres')
      .regex(slugRegex, 'El slug solo puede contener letras minúsculas, números y guiones, y no puede empezar ni terminar con guión')
      .optional(),
  })
  .refine((data) => data.name !== undefined || data.slug !== undefined, {
    message: 'Debe proporcionar al menos un campo (name o slug)',
  })

export const inviteSchema = z.object({
  email: z.string().trim().email('Email inválido'),
  role: z.enum(INVITATION_ROLES).default('member'),
})

export const updateMemberRoleSchema = z.object({
  role: z.enum(WORKSPACE_ROLES),
})

export const deleteWorkspaceSchema = z.object({
  confirmSlug: z.string().min(1, 'El slug de confirmación es obligatorio'),
})

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>
