export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { loginSchema } from '@/lib/validators/auth'
import { verifyPassword } from '@/lib/auth/password'
import { createSession, buildSessionCookieValue, SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from '@/lib/auth/session'
import { eq, and, isNull } from 'drizzle-orm'

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const parsed = loginSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const user = await db
      .select()
      .from(users)
      .where(and(eq(users.email, parsed.data.email), isNull(users.deletedAt)))
      .get()

    if (!user) {
      // Mitigación timing oracle: hash dummy para igualar tiempo de verifyPassword
      await verifyPassword('$2a$10$dummyhashdummyhashdummyhashdummyha', parsed.data.password).catch(() => {})
      return NextResponse.json({ error: 'Credenciales inválidas' }, { status: 401 })
    }

    const ok = await verifyPassword(user.passwordHash, parsed.data.password)
    if (!ok) {
      return NextResponse.json({ error: 'Credenciales inválidas' }, { status: 401 })
    }

    const headers = req.headers
    const forwarded = headers.get('x-forwarded-for')
    const realIp = headers.get('x-real-ip')
    const ipRaw = (forwarded ? forwarded.split(',')[0]!.trim() : realIp?.trim()) || null
    const ip = ipRaw?.slice(0, 45) ?? null
    const uaRaw = headers.get('user-agent') || null
    const ua = uaRaw?.slice(0, 512) ?? null

    const { token, expiresAt } = await createSession({ userId: user.id, ip, ua })

    const value = buildSessionCookieValue(user.id, token, expiresAt)
    const res = NextResponse.json(
      {
        user: { id: user.id, email: user.email, displayName: user.displayName, emailVerified: Boolean(user.emailVerified) },
      },
      { status: 200 }
    )
    res.cookies.set(SESSION_COOKIE_NAME, value, { ...SESSION_COOKIE_OPTIONS, expires: expiresAt })
    return res
  } catch (error) {
    console.error('[login] error interno:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
