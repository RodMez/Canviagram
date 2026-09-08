import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getTemplatePublicList } from '@/lib/templates/catalog'

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  return NextResponse.json({ templates: getTemplatePublicList() })
}