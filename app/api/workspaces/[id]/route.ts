export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { assertWorkspaceAccess } from '@/lib/auth/workspace-access'
import { handleApiError } from '@/lib/api-helpers'
import { updateWorkspace, deleteWorkspace } from '@/lib/workspace-admin'
import { deleteWorkspaceSchema } from '@/lib/validators/workspace'
import { ValidationError } from '@/lib/errors'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const { role, workspace } = await assertWorkspaceAccess(id, session.userId, 'viewer')
    return NextResponse.json({ workspace: { ...workspace, role } })
  } catch (error) {
    return handleApiError(error)
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  try {
    const { workspace } = await updateWorkspace(id, session.userId, body)
    return NextResponse.json({ workspace })
  } catch (error) {
    return handleApiError(error)
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  let parsed: ReturnType<typeof deleteWorkspaceSchema.parse>
  try {
    parsed = deleteWorkspaceSchema.parse(body)
  } catch (error) {
    if (error instanceof Error && 'issues' in error) {
      const zodError = error as { issues: unknown; message: string }
      return handleApiError(new ValidationError(zodError.message, zodError.issues))
    }
    return handleApiError(error)
  }

  try {
    await deleteWorkspace(id, session.userId, parsed!.confirmSlug)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return handleApiError(error)
  }
}
