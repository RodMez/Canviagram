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
  const rawToken = params.token
  const token = typeof rawToken === 'string' ? rawToken.trim() : ''

  if (!token || token.length === 0) {
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

    // Transacción atómica: marcar email verificado + borrar token de un solo uso
    try {
      db.transaction((tx) => {
        tx.update(users)
          .set({ emailVerified: true, updatedAt: now })
          .where(eq(users.id, record.userId))
          .run()
        tx.delete(emailVerificationTokens).where(eq(emailVerificationTokens.token, token)).run()
      })
    } catch (txError) {
      // Si la API de transaction falla por incompatibilidad async, fallback a operaciones secuenciales
      // Mantenemos manejo explícito de error en vez de silenciar
      const isTxUnsupported = txError instanceof Error && /transaction/i.test(txError.message)
      if (isTxUnsupported) {
        await db.update(users).set({ emailVerified: true, updatedAt: now }).where(eq(users.id, record.userId))
        await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.token, token))
      } else {
        throw txError
      }
    }

    return NextResponse.json({ success: true, message: 'Email verificado correctamente' })
  } catch (error) {
    console.error('verify-email error:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
