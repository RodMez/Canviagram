import * as brevo from '@getbrevo/brevo'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function sanitizeLog(email: string): string {
  const at = email.indexOf('@')
  if (at === -1) return '***'
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  const masked = local.length <= 1 ? '***' : `${local[0]}***`
  return `${masked}@${domain}`
}

function buildClientUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const clean = base.replace(/\/$/, '')
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${clean}${suffix}`
}

function getTransactionalApi(apiKey: string): { sendTransacEmail: (p: unknown) => Promise<unknown> } | null {
  try {
    const apiInstance: unknown = new (brevo as unknown as { TransactionalEmailsApi: new () => unknown }).TransactionalEmailsApi()
    try {
      const inst = apiInstance as {
        setApiKey?: (type: unknown, key: string) => void
        authentications?: Record<string, { apiKey?: string }>
      }
      const keyEnum = (brevo as unknown as { TransactionalEmailsApiApiKeys?: { apiKey?: unknown } })?.TransactionalEmailsApiApiKeys?.apiKey
      if (inst.setApiKey && keyEnum !== undefined) {
        inst.setApiKey(keyEnum, apiKey)
      } else if (inst.authentications && inst.authentications['apiKey']) {
        inst.authentications['apiKey'].apiKey = apiKey
      } else if (inst.authentications && inst.authentications['api-key']) {
        inst.authentications['api-key'].apiKey = apiKey
      }
    } catch {
      // ignorar error de configuración apiKey
    }
    return apiInstance as { sendTransacEmail: (p: unknown) => Promise<unknown> }
  } catch {
    return null
  }
}

function getSender() {
  const email = process.env.EMAIL_FROM || process.env.BREVO_SENDER_EMAIL || 'noreply@canviagram.local'
  return { email, name: 'Canviagram' }
}

function buildPayload(to: string, subject: string, htmlContent: string, textContent: string): Record<string, unknown> {
  const sender = getSender()
  const ctor = (brevo as unknown as { SendSmtpEmail?: new () => Record<string, unknown> })?.SendSmtpEmail
  if (ctor) {
    const mail = new ctor()
    mail['subject'] = subject
    mail['to'] = [{ email: to }]
    mail['htmlContent'] = htmlContent
    mail['textContent'] = textContent
    mail['sender'] = sender
    return mail
  }
  return {
    subject,
    to: [{ email: to }],
    htmlContent,
    textContent,
    sender,
  }
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) {
    console.warn('[brevo] skip sendVerificationEmail', sanitizeLog(to))
    return
  }
  const verifyUrl = `${buildClientUrl('/verify-email')}/${token}`
  const subject = 'Verifica tu email — Canviagram'
  const htmlContent = `<p>Hola,</p><p>Verifica tu email haciendo clic <a href="${verifyUrl}">aquí</a>.</p><p>Si no puedes hacer clic, copia este enlace: ${verifyUrl}</p><p>Este enlace expira en 24 horas.</p><p>— Canviagram</p>`
  const textContent = `Hola,\n\nVerifica tu email: ${verifyUrl}\n\nExpira en 24 horas.\n— Canviagram`
  const payload = buildPayload(to, subject, htmlContent, textContent)
  const api = getTransactionalApi(apiKey)
  if (!api?.sendTransacEmail) {
    console.warn('[brevo] SDK sin sendTransacEmail — skip', sanitizeLog(to))
    return
  }
  try {
    await api.sendTransacEmail(payload)
  } catch (err) {
    console.warn('[brevo] fallo no bloqueante', sanitizeLog(to), (err as Error).message.slice(0, 120))
  }
}

export async function sendPasswordReset(to: string, token: string): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) {
    console.warn('[brevo] skip sendPasswordReset', sanitizeLog(to))
    return
  }
  const resetUrl = `${buildClientUrl('/reset-password')}/${token}`
  const subject = 'Restablece tu contraseña — Canviagram'
  const htmlContent = `<p>Hola,</p><p>Restablece tu contraseña haciendo clic <a href="${resetUrl}">aquí</a>.</p><p>Si no solicitaste esto, ignora este correo.</p><p>Enlace: ${resetUrl}</p><p>Expira en 1 hora.</p><p>— Canviagram</p>`
  const textContent = `Hola,\n\nRestablece tu contraseña: ${resetUrl}\n\nExpira en 1 hora.\n— Canviagram`
  const payload = buildPayload(to, subject, htmlContent, textContent)
  const api = getTransactionalApi(apiKey)
  if (!api?.sendTransacEmail) {
    console.warn('[brevo] SDK sin sendTransacEmail — skip', sanitizeLog(to))
    return
  }
  try {
    await api.sendTransacEmail(payload)
  } catch (err) {
    console.warn('[brevo] fallo no bloqueante', sanitizeLog(to), (err as Error).message.slice(0, 120))
  }
}

export async function sendInvitation(to: string, token: string, workspaceName: string): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) {
    console.warn('[brevo] skip sendInvitation', sanitizeLog(to))
    return
  }
  const inviteUrl = `${buildClientUrl('/invite')}/${token}`
  const safeName = escapeHtml(workspaceName)
  const subject = `Invitación a ${safeName} — Canviagram`
  const htmlContent = `<p>Hola,</p><p>Has sido invitado al workspace <strong>${safeName}</strong> en Canviagram.</p><p>Acepta la invitación <a href="${inviteUrl}">aquí</a>.</p><p>Enlace: ${inviteUrl}</p><p>Expira en 7 días.</p><p>— Canviagram</p>`
  const textContent = `Hola,\n\nHas sido invitado a ${safeName} en Canviagram.\n\nAcepta aquí: ${inviteUrl}\n\nExpira en 7 días.\n— Canviagram`
  const payload = buildPayload(to, subject, htmlContent, textContent)
  const api = getTransactionalApi(apiKey)
  if (!api?.sendTransacEmail) {
    console.warn('[brevo] SDK sin sendTransacEmail — skip', sanitizeLog(to))
    return
  }
  try {
    await api.sendTransacEmail(payload)
  } catch (err) {
    console.warn('[brevo] fallo no bloqueante', sanitizeLog(to), (err as Error).message.slice(0, 120))
  }
}
