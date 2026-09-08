import { describe, it, expect, afterAll, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/lib/db'
import { users, workspaces, workspaceMembers, emailVerificationTokens, sessions, passwordResetTokens } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { hashToken } from '@/lib/auth/tokens'
import { sendPasswordReset } from '@/lib/email/brevo'

vi.mock('@/lib/email/brevo', () => ({
  sendPasswordReset: vi.fn(),
  sendVerificationEmail: vi.fn(),
  sendInvitation: vi.fn(),
}))

const sendPasswordResetMock = vi.mocked(sendPasswordReset)

describe('Password reset flow', () => {
  const createdUserIds: string[] = []

  async function cleanupUser(uid: string) {
    try {
      await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, uid))
    } catch {}
    try {
      await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, uid))
    } catch {}
    try {
      await db.delete(sessions).where(eq(sessions.userId, uid))
    } catch {}
    try {
      await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, uid))
    } catch {}
    try {
      const wss = await db.select().from(workspaces).where(eq(workspaces.ownerId, uid)).all()
      for (const w of wss as (typeof workspaces.$inferSelect)[]) {
        try {
          await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, w.id))
        } catch {}
        try {
          await db.delete(workspaces).where(eq(workspaces.id, w.id))
        } catch {}
      }
    } catch {}
    try {
      await db.delete(users).where(eq(users.id, uid))
    } catch {}
  }

  afterAll(async () => {
    for (const uid of createdUserIds) {
      await cleanupUser(uid)
    }
  })

  describe('POST /api/auth/password/reset', () => {
    it('200 genérico y guarda tokenHash (no el token plano)', async () => {
      sendPasswordResetMock.mockReset()
      sendPasswordResetMock.mockResolvedValue(undefined)

      const { POST: regPOST } = await import('@/app/api/auth/register/route')
      const email = `pwr-${uuidv4().slice(0, 8)}@example.com`
      const rReg = await regPOST(
        new Request('http://localhost/api/auth/register', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password: 'password123', displayName: 'Pw Reset User' }),
        })
      )
      expect(rReg.status).toBe(201)
      const jReg = await rReg.json()
      createdUserIds.push(jReg.user.id)

      const { POST } = await import('@/app/api/auth/password/reset/route')
      const res = await POST(
        new Request('http://localhost/api/auth/password/reset', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email }),
        })
      )
      expect(res.status).toBe(200)
      const j = await res.json()
      expect(j.message).toBe('Si el email existe, se ha enviado un enlace de recuperación')

      expect(sendPasswordResetMock).toHaveBeenCalledTimes(1)
      const plainToken = sendPasswordResetMock.mock.calls[0]![1]!
      expect(typeof plainToken).toBe('string')
      expect(plainToken.length).toBeGreaterThan(0)

      const row = await db
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.userId, jReg.user.id))
        .get()
      expect(row).toBeDefined()
      expect(row!.tokenHash).toBe(hashToken(plainToken))
      expect(row!.tokenHash).not.toBe(plainToken)
    })

    it('email inexistente → misma 200 con el MISMO mensaje', async () => {
      sendPasswordResetMock.mockReset()
      const { POST } = await import('@/app/api/auth/password/reset/route')
      const res = await POST(
        new Request('http://localhost/api/auth/password/reset', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'noexiste-pw@example.com' }),
        })
      )
      expect(res.status).toBe(200)
      expect((await res.json()).message).toBe('Si el email existe, se ha enviado un enlace de recuperación')
      expect(sendPasswordResetMock).not.toHaveBeenCalled()
    })

    it('400 email inválido', async () => {
      const { POST } = await import('@/app/api/auth/password/reset/route')
      const res = await POST(
        new Request('http://localhost/api/auth/password/reset', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'bad' }),
        })
      )
      expect(res.status).toBe(400)
    })
  })

  describe('POST /api/auth/password/reset/confirm', () => {
    it('200 actualiza password, borra sesiones y borra el token', async () => {
      const uid = uuidv4()
      const email = `pwrc-${uid.slice(0, 8)}@example.com`
      await db.insert(users).values({
        id: uid,
        email,
        passwordHash: await hashPassword('old-password'),
        displayName: 'Confirm User',
        emailVerified: true,
      })
      createdUserIds.push(uid)

      await db.insert(sessions).values({
        id: uuidv4(),
        userId: uid,
        tokenHash: hashToken(uuidv4()),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdAt: new Date(),
      })

      const plainToken = uuidv4()
      await db.insert(passwordResetTokens).values({
        id: uuidv4(),
        userId: uid,
        tokenHash: hashToken(plainToken),
        expiresAt: new Date(Date.now() + 3600_000),
        createdAt: new Date(),
      })

      const { POST } = await import('@/app/api/auth/password/reset/confirm/route')
      const res = await POST(
        new Request('http://localhost/api/auth/password/reset/confirm', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: plainToken, password: 'new-password-123' }),
        })
      )
      expect(res.status).toBe(200)
      const j = await res.json()
      expect(j.success).toBe(true)
      expect(j.message).toMatch(/Contraseña actualizada/)

      const user = await db.select().from(users).where(eq(users.id, uid)).get()
      expect(await verifyPassword(user!.passwordHash, 'new-password-123')).toBe(true)

      const sessionsLeft = await db.select().from(sessions).where(eq(sessions.userId, uid)).all()
      expect(sessionsLeft.length).toBe(0)

      const tokensLeft = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, uid)).all()
      expect(tokensLeft.length).toBe(0)
    })

    it('token inválido → 400', async () => {
      const { POST } = await import('@/app/api/auth/password/reset/confirm/route')
      const res = await POST(
        new Request('http://localhost/api/auth/password/reset/confirm', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: 'fake-token', password: 'new-password-123' }),
        })
      )
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Token no válido o expirado')
    })

    it('token expirado → 400', async () => {
      const uid = uuidv4()
      await db.insert(users).values({
        id: uid,
        email: `pwre-${uid.slice(0, 8)}@example.com`,
        passwordHash: await hashPassword('old-password'),
        displayName: 'Expired User',
        emailVerified: true,
      })
      createdUserIds.push(uid)

      const plainToken = uuidv4()
      await db.insert(passwordResetTokens).values({
        id: uuidv4(),
        userId: uid,
        tokenHash: hashToken(plainToken),
        expiresAt: new Date(Date.now() - 1000),
        createdAt: new Date(),
      })

      const { POST } = await import('@/app/api/auth/password/reset/confirm/route')
      const res = await POST(
        new Request('http://localhost/api/auth/password/reset/confirm', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: plainToken, password: 'new-password-123' }),
        })
      )
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Token no válido o expirado')
    })

    it('token ya usado → 400', async () => {
      const uid = uuidv4()
      await db.insert(users).values({
        id: uid,
        email: `pwru-${uid.slice(0, 8)}@example.com`,
        passwordHash: await hashPassword('old-password'),
        displayName: 'Used User',
        emailVerified: true,
      })
      createdUserIds.push(uid)

      const plainToken = uuidv4()
      await db.insert(passwordResetTokens).values({
        id: uuidv4(),
        userId: uid,
        tokenHash: hashToken(plainToken),
        expiresAt: new Date(Date.now() + 3600_000),
        usedAt: new Date(),
        createdAt: new Date(),
      })

      const { POST } = await import('@/app/api/auth/password/reset/confirm/route')
      const res = await POST(
        new Request('http://localhost/api/auth/password/reset/confirm', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: plainToken, password: 'new-password-123' }),
        })
      )
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Token no válido o expirado')
    })

    it('400 con schema inválido', async () => {
      const { POST } = await import('@/app/api/auth/password/reset/confirm/route')
      const res = await POST(
        new Request('http://localhost/api/auth/password/reset/confirm', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: '', password: 'short' }),
        })
      )
      expect(res.status).toBe(400)
    })
  })
})