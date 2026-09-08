export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users, passwordResetTokens } from '@/lib/db/schema'
import { requestPasswordResetSchema } from '@/lib/validators/auth'
import { hashToken } from '@/lib/auth/tokens'
import { sendPasswordReset } from '@/lib/email/brevo'
import { eq, isNull, and } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

const generic = { message: 'Si el email existe, se ha enviado un enlace de recuperación' }

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Datos inválidos', details: 'JSON inválido' }, { status: 400 })
  }

  const parsed = requestPasswordResetSchema.safeParse(body)
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
      return NextResponse.json(generic, { status: 200 })
    }

    const tokenPlano = uuidv4()
    const now = new Date()
    const expiresAt = new Date(Date.now() + 3600_000)
    const id = uuidv4()

    // Transacción atómica (better-sqlite3 sync): invalidar previos + insertar nuevo
    db.transaction((tx) => {
      tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id)).run()
      tx.insert(passwordResetTokens)
        .values({
          id,
          userId: user.id,
          tokenHash: hashToken(tokenPlano),
          expiresAt,
          createdAt: now,
        })
        .run()
    })

    try {
      await sendPasswordReset(user.email, tokenPlano)
    } catch (e) {
      console.warn('[password/reset] sendPasswordReset no bloqueante falló:', e)
    }

    return NextResponse.json(generic, { status: 200 })
  } catch (error) {
    console.error('[password/reset] error interno:', error)
    // Anti-enumeración: respuesta genérica incluso en error interno (patrón verify-email/resend)
    return NextResponse.json(generic, { status: 200 })
  }
}