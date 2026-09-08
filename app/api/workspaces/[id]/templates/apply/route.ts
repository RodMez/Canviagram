import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { applyTemplate } from '@/lib/canvas-service'
import { handleApiError } from '@/lib/api-helpers'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
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

  const templateId = (body as { templateId?: unknown })?.templateId
  if (typeof templateId !== 'string' || templateId.length === 0) {
    return NextResponse.json({ error: 'templateId es requerido' }, { status: 400 })
  }

  try {
    const result = await applyTemplate(id, session.userId, templateId)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return handleApiError(error)
  }
}