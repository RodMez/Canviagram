export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { emailVerificationTokens, users } from '@/lib/db/schema'
import { hashToken } from '@/lib/auth/tokens'
import { eq } from 'drizzle-orm'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token: rawToken } = await params
  const token = typeof rawToken === 'string' ? rawToken.trim() : ''

  if (!token || token.length === 0) {
    return NextResponse.json({ error: 'Token requerido' }, { status: 400 })
  }

  try {
    const record = await db
      .select()
      .from(emailVerificationTokens)
      .where(eq(emailVerificationTokens.tokenHash, hashToken(token)))
      .get()

    if (!record) {
      return NextResponse.json({ error: 'Token no encontrado' }, { status: 404 })
    }

    const now = new Date()
    if (record.expiresAt < now) {
      return NextResponse.json({ error: 'Token expirado' }, { status: 400 })
    }

    // Transacción atómica: marcar email verificado + borrar token de un solo uso
    db.transaction((tx) => {
      tx.update(users)
        .set({ emailVerified: true, updatedAt: now })
        .where(eq(users.id, record.userId))
        .run()
      tx.delete(emailVerificationTokens).where(eq(emailVerificationTokens.tokenHash, hashToken(token))).run()
    })

    return NextResponse.json({ success: true, message: 'Email verificado correctamente' })
  } catch (error) {
    console.error('verify-email error:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
