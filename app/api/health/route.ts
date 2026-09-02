export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'

export async function GET() {
  try {
    db.run(sql`SELECT 1`)
    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    console.error('[health] DB check failed:', error)
    return NextResponse.json({ status: 'error', error: 'DB unavailable' }, { status: 500 })
  }
}
