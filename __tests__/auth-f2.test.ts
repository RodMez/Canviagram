import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/lib/db'
import { users, workspaces, workspaceMembers, emailVerificationTokens, sessions } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { hashPassword, verifyPassword, BCRYPT_ROUNDS } from '@/lib/auth/password'
import { sign, buildSessionCookieValue, parseAndVerifyCookieValue, createSession, destroySession, SESSION_COOKIE_NAME } from '@/lib/auth/session'
import { sendVerificationEmail } from '@/lib/email/brevo'

describe('F2.1 Auth Backend', () => {
  // Limpieza helpers
  const createdUserIds: string[] = []
  const createdWorkspaceIds: string[] = []

  afterAll(async () => {
    // Limpieza best-effort
    for (const uid of createdUserIds) {
      try {
        await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, uid))
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
            await db.delete(workspaces).where(eq(workspaces.id, w.id))
          } catch {}
        }
      } catch {}
      try {
        await db.delete(users).where(eq(users.id, uid))
      } catch {}
    }
  })

  describe('password.ts', () => {
    it('BCRYPT_ROUNDS=10 y hash/verify', async () => {
      expect(BCRYPT_ROUNDS).toBe(10)
      const hash = await hashPassword('password123')
      expect(hash).not.toBe('password123')
      expect(await verifyPassword(hash, 'password123')).toBe(true)
      expect(await verifyPassword(hash, 'wrong')).toBe(false)
    })
  })

  describe('session.ts', () => {
    it('sign y verify HMAC', () => {
      const tok = uuidv4()
      const h = sign(tok)
      expect(typeof h).toBe('string')
      expect(h.length).toBe(64)
      // verifySignature indirectly via parseAndVerifyCookieValue
      const val = buildSessionCookieValue('user-1', tok, new Date(Date.now() + 60000))
      const parsed = parseAndVerifyCookieValue(val)
      expect(parsed).not.toBeNull()
      expect(parsed!.userId).toBe('user-1')
      expect(parsed!.token).toBe(tok)
    })

    it('createSession y destroySession con tokenHash HMAC', async () => {
      const uid = uuidv4()
      await db.insert(users).values({
        id: uid,
        email: `sess-${uid.slice(0, 6)}@example.com`,
        passwordHash: await hashPassword('test12345'),
        displayName: 'Sess User',
        emailVerified: false,
      })
      createdUserIds.push(uid)

      const { token, expiresAt, session } = await createSession({ userId: uid, ip: '127.0.0.1', ua: 'vitest' })
      expect(token).toBeTruthy()
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000)
      const stored = await db.select().from(sessions).where(eq(sessions.tokenHash, sign(token))).get()
      expect(stored).toBeDefined()
      expect(stored!.userId).toBe(uid)
      expect(stored!.tokenHash).toBe(sign(token))
      expect(stored!.ipAddress).toBe('127.0.0.1')

      await destroySession(token)
      const after = await db.select().from(sessions).where(eq(sessions.tokenHash, sign(token))).get()
      expect(after).toBeUndefined()

      // cleanup user (will be done afterAll) but remove sessions already
      await db.delete(users).where(eq(users.id, uid)).catch(() => {})
      createdUserIds.splice(createdUserIds.indexOf(uid), 1)
    })
  })

  describe('brevo stub', () => {
    it('sendVerificationEmail no bloqueante sin BREVO_API_KEY', async () => {
      const orig = process.env.BREVO_API_KEY
      delete process.env.BREVO_API_KEY
      await expect(sendVerificationEmail('test@example.com', 'tok-123')).resolves.toBeUndefined()
      if (orig) process.env.BREVO_API_KEY = orig
    })
  })

  describe('POST /api/auth/register', () => {
    it('201 crea usuario + workspace + session HMAC + Set-Cookie', async () => {
      // limpiar posible leftover de runs previos (slug ana-lopez)
      try {
        // buscar workspaces con slug ana-lopez y borrar con cascade de miembros primero
        const existing = await db.select().from(workspaces).where(eq(workspaces.slug, 'ana-lopez')).get()
        if (existing) {
          await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, existing.id)).catch(() => {})
          await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, existing.ownerId)).catch(() => {})
          await db.delete(sessions).where(eq(sessions.userId, existing.ownerId)).catch(() => {})
          await db.delete(workspaces).where(eq(workspaces.id, existing.id)).catch(() => {})
          await db.delete(users).where(eq(users.id, existing.ownerId)).catch(() => {})
        }
        const dup = await db.select().from(workspaces).where(eq(workspaces.slug, 'ana-lopez-2')).get()
        if (dup) {
          await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, dup.id)).catch(() => {})
          await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, dup.ownerId)).catch(() => {})
          await db.delete(sessions).where(eq(sessions.userId, dup.ownerId)).catch(() => {})
          await db.delete(workspaces).where(eq(workspaces.id, dup.id)).catch(() => {})
          await db.delete(users).where(eq(users.id, dup.ownerId)).catch(() => {})
        }
      } catch {}
      const { POST } = await import('@/app/api/auth/register/route')
      const email = `reg-${uuidv4().slice(0, 8)}@example.com`
      const displayName = 'Ana López'
      const req = new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123', displayName }),
      })
      const res = await POST(req)
      expect(res.status).toBe(201)
      const json = await res.json()
      expect(json.user.email).toBe(email)
      expect(json.user.emailVerified).toBe(false)
      expect(json.workspace.slug).toBe('ana-lopez')
      const setCookie = res.headers.get('set-cookie') || res.headers.get('Set-Cookie')
      expect(setCookie).toContain(SESSION_COOKIE_NAME)
      expect(setCookie).toContain('HttpOnly')
      expect(setCookie?.toLowerCase()).toContain('samesite=lax')
      // verificar sesión en DB tiene tokenHash = HMAC(token) extraído de cookie
      const raw = setCookie!.split(';')[0]!.split('=')[1]!
      const decoded = decodeURIComponent(raw)
      const parsed = parseAndVerifyCookieValue(decoded)
      expect(parsed).not.toBeNull()
      const stored = await db.select().from(sessions).where(eq(sessions.tokenHash, sign(parsed!.token))).get()
      expect(stored).toBeDefined()
      expect(stored!.userId).toBe(json.user.id)
      // guardar para cleanup
      createdUserIds.push(json.user.id)
      createdWorkspaceIds.push(json.workspace.id)

      // verificar emailVerification token 24h
      const ev = await db.select().from(emailVerificationTokens).where(eq(emailVerificationTokens.userId, json.user.id)).get()
      expect(ev).toBeDefined()
      expect(ev!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000)
    })

    it('slug dedup: segundo registro mismo displayName -> ana-lopez o ana-2 con sufijo', async () => {
      const { POST } = await import('@/app/api/auth/register/route')
      const displayName = `Ana Test Dedup ${uuidv4().slice(0, 4)}`
      // primer registro con displayName único para evitar colisión con anterior
      const email1 = `dedup1-${uuidv4().slice(0, 6)}@example.com`
      const r1 = await POST(new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email1, password: 'password123', displayName }),
      }))
      expect(r1.status).toBe(201)
      const j1 = await r1.json()
      createdUserIds.push(j1.user.id)

      const email2 = `dedup2-${uuidv4().slice(0, 6)}@example.com`
      const r2 = await POST(new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email2, password: 'password123', displayName }),
      }))
      expect(r2.status).toBe(201)
      const j2 = await r2.json()
      createdUserIds.push(j2.user.id)
      // slug debe ser con sufijo -2
      expect(j2.workspace.slug).toMatch(/-2$/)
      expect(j1.workspace.slug).not.toBe(j2.workspace.slug)
    })

    it('409 email duplicado', async () => {
      const { POST } = await import('@/app/api/auth/register/route')
      const email = `dup-${uuidv4().slice(0, 6)}@example.com`
      const req1 = new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123', displayName: 'Dup User' }),
      })
      const r1 = await POST(req1)
      expect(r1.status).toBe(201)
      const j1 = await r1.json()
      createdUserIds.push(j1.user.id)

      const req2 = new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123', displayName: 'Dup User 2' }),
      })
      const r2 = await POST(req2)
      expect(r2.status).toBe(409)
      const j2 = await r2.json()
      expect(j2.error).toMatch(/ya está registrado/i)
    })

    it('400 con datos inválidos', async () => {
      const { POST } = await import('@/app/api/auth/register/route')
      const r = await POST(new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'no-email', password: 'short', displayName: 'A' }),
      }))
      expect(r.status).toBe(400)
      const j = await r.json()
      expect(j.error).toBeDefined()
    })
  })

  describe('POST /api/auth/login', () => {
    it('200 con credenciales correctas + Set-Cookie', async () => {
      const { POST: regPOST } = await import('@/app/api/auth/register/route')
      const email = `login-${uuidv4().slice(0, 6)}@example.com`
      const pw = 'password123'
      const rReg = await regPOST(new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: pw, displayName: 'Login User' }),
      }))
      const jReg = await rReg.json()
      createdUserIds.push(jReg.user.id)

      const { POST } = await import('@/app/api/auth/login/route')
      const res = await POST(new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4', 'user-agent': 'vitest-ua' },
        body: JSON.stringify({ email, password: pw }),
      }))
      expect(res.status).toBe(200)
      const j = await res.json()
      expect(j.user.email).toBe(email)
      const sc = res.headers.get('set-cookie') || res.headers.get('Set-Cookie')
      expect(sc).toContain(SESSION_COOKIE_NAME)
      const raw = sc!.split(';')[0]!.split('=')[1]!
      const parsed = parseAndVerifyCookieValue(decodeURIComponent(raw))
      expect(parsed).not.toBeNull()
      const stored = await db.select().from(sessions).where(eq(sessions.tokenHash, sign(parsed!.token))).get()
      expect(stored!.ipAddress).toBe('1.2.3.4')
      expect(stored!.userAgent).toBe('vitest-ua')
    })

    it('401 genérico con password erróneo y anti-enumeración', async () => {
      const { POST } = await import('@/app/api/auth/login/route')
      // usuario inexistente
      const r1 = await POST(new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'noexiste@example.com', password: 'whatever' }),
      }))
      expect(r1.status).toBe(401)
      const j1 = await r1.json()
      expect(j1.error).toMatch(/Credenciales inválidas/)

      // usuario existente pero password mal
      const { POST: regPOST } = await import('@/app/api/auth/register/route')
      const email = `loginfail-${uuidv4().slice(0, 6)}@example.com`
      const rReg = await regPOST(new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123', displayName: 'Fail User' }),
      }))
      const jReg = await rReg.json()
      createdUserIds.push(jReg.user.id)
      const r2 = await POST(new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'wrong-pass' }),
      }))
      expect(r2.status).toBe(401)
      expect((await r2.json()).error).toMatch(/Credenciales inválidas/)
    })

    it('400 con schema inválido', async () => {
      const { POST } = await import('@/app/api/auth/login/route')
      const r = await POST(new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'bad', password: '' }),
      }))
      expect(r.status).toBe(400)
    })
  })

  describe('POST /api/auth/logout', () => {
    it('204 idempotente + clear cookie', async () => {
      const { POST } = await import('@/app/api/auth/logout/route')
      const r = await POST()
      expect(r.status).toBe(204)
      const sc = r.headers.get('set-cookie') || r.headers.get('Set-Cookie')
      // NextResponse may set multiple cookies concatenated con ','
      // Verificar que contiene max-age=0 o expires en 1970
      const headerVal = r.headers.get('set-cookie') ?? ''
      // Next.js puede exponer set-cookie como string único o array; verificamos que incluye __Host-session
      const all = (r.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [headerVal]
      const joined = all.join(',')
      expect(joined).toContain(SESSION_COOKIE_NAME)
      expect(joined.toLowerCase()).toContain('max-age=0')
    })
  })

  describe('POST /api/auth/verify-email/resend', () => {
    it('200 genérico y regen token 24h', async () => {
      const { POST: regPOST } = await import('@/app/api/auth/register/route')
      const email = `resend-${uuidv4().slice(0, 6)}@example.com`
      const rReg = await regPOST(new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123', displayName: 'Resend User' }),
      }))
      const jReg = await rReg.json()
      createdUserIds.push(jReg.user.id)
      const before = await db.select().from(emailVerificationTokens).where(eq(emailVerificationTokens.userId, jReg.user.id)).get()
      expect(before).toBeDefined()

      const { POST } = await import('@/app/api/auth/verify-email/resend/route')
      const r = await POST(new Request('http://localhost/api/auth/verify-email/resend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      }))
      expect(r.status).toBe(200)
      const j = await r.json()
      expect(j.message).toMatch(/Si el email existe/)
      const after = await db.select().from(emailVerificationTokens).where(eq(emailVerificationTokens.userId, jReg.user.id)).get()
      expect(after).toBeDefined()
      expect(after!.token).not.toBe(before!.token)
      expect(after!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000)
    })

    it('anti-enumeración: email inexistente sigue 200 genérico', async () => {
      const { POST } = await import('@/app/api/auth/verify-email/resend/route')
      const r = await POST(new Request('http://localhost/api/auth/verify-email/resend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'noexiste-xyz@example.com' }),
      }))
      expect(r.status).toBe(200)
      expect((await r.json()).message).toMatch(/Si el email existe/)
    })

    it('si ya verificado sigue genérico', async () => {
      const uid = uuidv4()
      const email = `verified-${uid.slice(0, 6)}@example.com`
      await db.insert(users).values({
        id: uid,
        email,
        passwordHash: await hashPassword('password123'),
        displayName: 'Verified',
        emailVerified: true,
      })
      createdUserIds.push(uid)
      const { POST } = await import('@/app/api/auth/verify-email/resend/route')
      const r = await POST(new Request('http://localhost/api/auth/verify-email/resend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      }))
      expect(r.status).toBe(200)
      expect((await r.json()).message).toMatch(/Si el email existe/)
    })

    it('400 email inválido', async () => {
      const { POST } = await import('@/app/api/auth/verify-email/resend/route')
      const r = await POST(new Request('http://localhost/api/auth/verify-email/resend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'bad' }),
      }))
      expect(r.status).toBe(400)
    })
  })
})
