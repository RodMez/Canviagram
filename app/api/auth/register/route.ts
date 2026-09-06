export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users, workspaces, workspaceMembers, emailVerificationTokens, sessions } from '@/lib/db/schema'
import { registerSchema } from '@/lib/validators/auth'
import { hashPassword } from '@/lib/auth/password'
import { buildSessionCookieValue, sign, SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from '@/lib/auth/session'
import { sendVerificationEmail } from '@/lib/email/brevo'
import { eq, isNull, and } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

function toSlug(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const parsed = registerSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 400 })
  }

  const { email, password, displayName } = parsed.data

  try {
    const existing = await db
      .select()
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .get()

    if (existing) {
      return NextResponse.json({ error: 'El email ya está registrado' }, { status: 409 })
    }

    const passwordHash = await hashPassword(password)

    let baseSlug = toSlug(displayName)
    if (!baseSlug) baseSlug = 'workspace'
    // Truncate base to leave room for suffix -100 (max 4 chars) y límite 50
    if (baseSlug.length > 50) baseSlug = baseSlug.slice(0, 50).replace(/-+$/g, '')

    let finalSlug = baseSlug
    // Verificar unicidad con SELECT workspaces where slug=candidate
    let clash = await db.select().from(workspaces).where(eq(workspaces.slug, finalSlug)).get()
    let counter = 2
    while (clash && counter <= 100) {
      const suffix = `-${counter}`
      const maxBaseLen = 50 - suffix.length
      const truncatedBase = baseSlug.slice(0, maxBaseLen).replace(/-+$/g, '')
      finalSlug = `${truncatedBase}${suffix}`
      clash = await db.select().from(workspaces).where(eq(workspaces.slug, finalSlug)).get()
      counter++
    }
    if (clash) {
      return NextResponse.json({ error: 'No se pudo generar slug único' }, { status: 409 })
    }

    const userId = uuidv4()
    const workspaceId = uuidv4()
    const memberId = uuidv4()
    const emailTokenId = uuidv4()
    const sessionId = uuidv4()

    const sessionToken = uuidv4()
    const verifyToken = uuidv4()
    const tokenHash = sign(sessionToken)
    const now = new Date()
    const expiresSession = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const expiresVerify = new Date(now.getTime() + 24 * 60 * 60 * 1000)

    // Transacción atómica better-sqlite3 sync + fallback secuencial
    try {
      db.transaction((tx) => {
        tx.insert(users)
          .values({
            id: userId,
            email,
            passwordHash,
            displayName,
            emailVerified: false,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          })
          .run()
        tx.insert(workspaces)
          .values({
            id: workspaceId,
            ownerId: userId,
            name: displayName,
            slug: finalSlug,
            createdAt: now,
            updatedAt: now,
          })
          .run()
        tx.insert(workspaceMembers)
          .values({
            id: memberId,
            workspaceId,
            userId,
            role: 'owner',
            joinedAt: now,
            createdAt: now,
          })
          .run()
        tx.insert(emailVerificationTokens)
          .values({
            id: emailTokenId,
            userId,
            token: verifyToken,
            expiresAt: expiresVerify,
            createdAt: now,
          })
          .run()
        tx.insert(sessions)
          .values({
            id: sessionId,
            userId,
            tokenHash,
            expiresAt: expiresSession,
            ipAddress: null,
            userAgent: null,
            createdAt: now,
          })
          .run()
      })
    } catch (txError) {
      // Fallback secuencial si transaction lanza (ej. incompatibilidad async)
      // No await dentro de tx, aquí sí await secuencial
      const isTxUnsupported =
        txError instanceof Error && /transaction/i.test(txError.message)
      if (isTxUnsupported) {
        await db.insert(users).values({
          id: userId,
          email,
          passwordHash,
          displayName,
          emailVerified: false,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        })
        await db.insert(workspaces).values({
          id: workspaceId,
          ownerId: userId,
          name: displayName,
          slug: finalSlug,
          createdAt: now,
          updatedAt: now,
        })
        await db.insert(workspaceMembers).values({
          id: memberId,
          workspaceId,
          userId,
          role: 'owner',
          joinedAt: now,
          createdAt: now,
        })
        await db.insert(emailVerificationTokens).values({
          id: emailTokenId,
          userId,
          token: verifyToken,
          expiresAt: expiresVerify,
          createdAt: now,
        })
        await db.insert(sessions).values({
          id: sessionId,
          userId,
          tokenHash,
          expiresAt: expiresSession,
          ipAddress: null,
          userAgent: null,
          createdAt: now,
        })
      } else {
        throw txError
      }
    }

    const value = buildSessionCookieValue(userId, sessionToken, expiresSession)
    const res = NextResponse.json(
      {
        user: { id: userId, email, displayName, emailVerified: false },
        workspace: { id: workspaceId, name: displayName, slug: finalSlug },
      },
      { status: 201 }
    )
    res.cookies.set(SESSION_COOKIE_NAME, value, { ...SESSION_COOKIE_OPTIONS, expires: expiresSession })

    try {
      await sendVerificationEmail(email, verifyToken)
    } catch (e) {
      console.warn('[register] sendVerificationEmail no bloqueante falló:', e)
    }

    return res
  } catch (error) {
    // Manejar UNIQUE constraint de forma explícita sin loggear password/token
    if (error instanceof Error) {
      const msg = error.message.toLowerCase()
      const isUnique =
        msg.includes('unique') ||
        msg.includes('constraint') ||
        msg.includes('idx_users_email') ||
        msg.includes('idx_workspaces_slug') ||
        msg.includes('users_email_unique') ||
        msg.includes('workspaces_slug_unique')
      if (isUnique) {
        if (msg.includes('workspace') || msg.includes('slug')) {
          return NextResponse.json({ error: 'El slug ya está en uso' }, { status: 409 })
        }
        return NextResponse.json({ error: 'El email ya está registrado' }, { status: 409 })
      }
    }
    console.error('[register] error interno:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
