export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { emailVerificationTokens, users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function GET(
  _request: Request,
  { params }: { params: { token: string } }
) {
  const token = params.token

  if (!token || typeof token !== 'string' || token.trim().length === 0) {
    return NextResponse.json({ error: 'Token requerido' }, { status: 400 })
  }

  try {
    const record = await db
      .select()
      .from(emailVerificationTokens)
      .where(eq(emailVerificationTokens.token, token))
      .get()

    if (!record) {
      return NextResponse.json({ error: 'Token no encontrado' }, { status: 404 })
    }

    const now = new Date()
    if (record.expiresAt < now) {
      return NextResponse.json({ error: 'Token expirado' }, { status: 400 })
    }

    // F2 partial: marcar email como verificado pero sin Brevo send
    await db
      .update(users)
      .set({ emailVerified: true, updatedAt: now })
      .where(eq(users.id, record.userId))

    // Borrar token usado (un solo uso)
    await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.token, token))

    return NextResponse.json({ success: true, message: 'Email verificado correctamente' })
  } catch (error) {
    console.error('verify-email error:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
