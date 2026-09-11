export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/session'
import { assertIsAdmin } from '@/lib/auth/platform-access'
import { getAiSettings, saveAiSettings } from '@/lib/ai/settings'
import { handleApiError } from '@/lib/api-helpers'
import { ValidationError } from '@/lib/errors'

// ============================================================
// Configuración de la instancia (F5.5): modelo de IA + fallbacks.
// Solo users.role='admin'. Sin UI de promover/degradar: el primer
// admin se asigna a mano (ver README):
//   UPDATE users SET role='admin' WHERE email='TU_EMAIL_AQUI';
// ============================================================

const putSchema = z
  .object({
    model: z.string().trim().min(1, 'El modelo es requerido').max(200, 'El modelo no puede exceder 200 caracteres'),
    fallback: z.array(z.string().trim().min(1).max(200)).max(10, 'Máximo 10 modelos de respaldo').default([]),
  })
  .superRefine((data, ctx) => {
    if (data.fallback.includes(data.model)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fallback'],
        message: 'El respaldo no debe contener el modelo activo',
      })
    }
  })

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    await assertIsAdmin(session.userId)
    const settings = await getAiSettings()
    return NextResponse.json(settings)
  } catch (error) {
    return handleApiError(error)
  }
}

export async function PUT(request: Request) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const parsed = putSchema.safeParse(body)
  if (!parsed.success) {
    return handleApiError(new ValidationError(parsed.error.message, parsed.error.issues))
  }

  try {
    await assertIsAdmin(session.userId)
    const settings = await saveAiSettings(parsed.data.model, parsed.data.fallback)
    return NextResponse.json(settings)
  } catch (error) {
    return handleApiError(error)
  }
}
