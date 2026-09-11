export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getTodayItems } from '@/lib/today-service'
import { handleApiError } from '@/lib/api-helpers'

// GET /api/today — agregado personal del usuario autenticado (F5.4).
// Sin guard de rol: cada usuario ve SU propio agregado.
export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const items = await getTodayItems(session.userId)
    return NextResponse.json({ items })
  } catch (error) {
    return handleApiError(error)
  }
}
