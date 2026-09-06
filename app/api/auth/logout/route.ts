export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getSession, destroySession, SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS, LEGACY_COOKIE_NAME } from '@/lib/auth/session'

export async function POST() {
  try {
    const session = await getSession()
    if (session?.token) {
      await destroySession(session.token).catch(() => {
        // No bloqueante, no loggear token plano
      })
    }
  } catch {
    // No propagar error, logout siempre idempotente
  }

  const res = new NextResponse(null, { status: 204 })
  res.cookies.set(SESSION_COOKIE_NAME, '', { ...SESSION_COOKIE_OPTIONS, expires: new Date(0), maxAge: 0 })
  res.cookies.set(LEGACY_COOKIE_NAME, '', { ...SESSION_COOKIE_OPTIONS, expires: new Date(0), maxAge: 0 })
  return res
}
