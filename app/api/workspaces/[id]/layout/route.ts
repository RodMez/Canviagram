import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { relayoutWorkspace } from '@/lib/canvas-service'
import { handleApiError } from '@/lib/api-helpers'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const result = await relayoutWorkspace(id, session.userId)
    return NextResponse.json(result)
  } catch (error) {
    return handleApiError(error)
  }
}