export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  // F2 no implementado: generación de código de vinculación Telegram
  // Por ahora retornamos 501 con guard de sesión ya validado
  return NextResponse.json({ error: 'Not implemented', workspaceId: params.id, userId: session.userId }, { status: 501 })
}
