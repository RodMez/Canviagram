import { z } from 'zod'

export const registerSchema = z.object({
  email: z.string().email('El email no es válido'),
  password: z
    .string()
    .min(8, 'La contraseña debe tener al menos 8 caracteres')
    .max(128, 'La contraseña no puede exceder 128 caracteres'),
  displayName: z
    .string()
    .trim()
    .min(2, 'El nombre debe tener al menos 2 caracteres')
    .max(50, 'El nombre no puede exceder 50 caracteres'),
})

export const loginSchema = z.object({
  email: z.string().email('El email no es válido'),
  password: z.string().min(1, 'La contraseña es requerida'),
})

export const requestPasswordResetSchema = z.object({
  email: z.string().email('El email no es válido'),
})

export const resetPasswordSchema = z.object({
  token: z.string().min(1).max(512),
  password: z
    .string()
    .min(8, 'La contraseña debe tener al menos 8 caracteres')
    .max(128),
})

export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>
