export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users, emailVerificationTokens } from '@/lib/db/schema'
import { sendVerificationEmail } from '@/lib/email/brevo'
import { hashToken } from '@/lib/auth/tokens'
import { eq, isNull, and } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'

const resendSchema = z.object({ email: z.string().email('El email no es válido') })

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Datos inválidos', details: 'JSON inválido' }, { status: 400 })
  }

  const parsed = resendSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 400 })
  }

  const generic = { message: 'Si el email existe y no está verificado, se ha enviado un nuevo correo' }

  try {
    const user = await db
      .select()
      .from(users)
      .where(and(eq(users.email, parsed.data.email), isNull(users.deletedAt)))
      .get()

    if (!user || Boolean(user.emailVerified)) {
      return NextResponse.json(generic, { status: 200 })
    }

    const newToken = uuidv4()
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const now = new Date()
    const id = uuidv4()

    // Transacción atómica (better-sqlite3 sync): reemplaza tokens pendientes
    db.transaction((tx) => {
      tx.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, user.id)).run()
      tx.insert(emailVerificationTokens)
        .values({
          id,
          userId: user.id,
          tokenHash: hashToken(newToken),
          expiresAt,
          createdAt: now,
        })
        .run()
    })

    try {
      await sendVerificationEmail(user.email, newToken)
    } catch (e) {
      console.warn('[verify-email/resend] sendVerificationEmail no bloqueante falló:', e)
    }

    return NextResponse.json(generic, { status: 200 })
  } catch (error) {
    console.error('[verify-email/resend] error interno:', error)
    // Anti-enumeración: incluso en error interno devolver genérico, pero si es Zod/DB crítico devolver 500?
    // Para no filtrar existencia, en caso de error inesperado devolver genérico 200 si es DB select, o 500 si es transacción
    // Optamos por genérico para no enumerar, salvo que sea fallo grave
    if (error instanceof Error && /unique|constraint/i.test(error.message)) {
      return NextResponse.json(generic, { status: 200 })
    }
    return NextResponse.json(generic, { status: 200 })
  }
}
