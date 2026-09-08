export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users, sessions, passwordResetTokens } from '@/lib/db/schema'
import { resetPasswordSchema } from '@/lib/validators/auth'
import { hashToken } from '@/lib/auth/tokens'
import { hashPassword } from '@/lib/auth/password'
import { eq } from 'drizzle-orm'

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Datos inválidos', details: 'JSON inválido' }, { status: 400 })
  }

  const parsed = resetPasswordSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const row = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, hashToken(parsed.data.token)))
      .get()

    if (!row) {
      return NextResponse.json({ error: 'Token no válido o expirado' }, { status: 400 })
    }

    const now = new Date()
    if (row.expiresAt.getTime() < now.getTime()) {
      return NextResponse.json({ error: 'Token no válido o expirado' }, { status: 400 })
    }
    if (row.usedAt !== null) {
      return NextResponse.json({ error: 'Token no válido o expirado' }, { status: 400 })
    }

    // bcrypt es async → calcular antes de la transacción sync de better-sqlite3
    const passwordHash = await hashPassword(parsed.data.password)

    db.transaction((tx) => {
      tx.delete(sessions).where(eq(sessions.userId, row.userId)).run()
      tx.update(users)
        .set({ passwordHash, updatedAt: now })
        .where(eq(users.id, row.userId))
        .run()
      // El DELETE es la invalidación definitiva (single-use); no hace falta
      // marcar usedAt primero — sería código muerto en la misma transacción.
      tx.delete(passwordResetTokens).where(eq(passwordResetTokens.id, row.id)).run()
    })

    return NextResponse.json({
      success: true,
      message: 'Contraseña actualizada. Inicia sesión con tu nueva contraseña.',
    })
  } catch (error) {
    console.error('[password/reset/confirm] error interno:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}