import webpush from 'web-push'
import { db } from '@/lib/db'
import { webPushSubscriptions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { ensureVapidConfigured } from '@/lib/push/config'

// ============================================================
// Envío de Web Push a un workspace (Fase 3)
//
// Envía la notificación a TODAS las suscripciones de los miembros
// del workspace (sin importar el workspace activo en Telegram).
// Las suscripciones expiradas (404/410) se podan automáticamente.
// No lanza errores: best-effort, registra y continúa.
// ============================================================

export type PushPayload = { title: string; body: string; url?: string }

export async function sendPushToWorkspace(workspaceId: string, payload: PushPayload) {
  if (!ensureVapidConfigured()) return { sent: 0, total: 0 }

  const subs = await db
    .select()
    .from(webPushSubscriptions)
    .where(eq(webPushSubscriptions.workspaceId, workspaceId))
    .all()

  let sent = 0
  for (const sub of subs) {
    const subscription = {
      endpoint: sub.endpoint,
      keys: { auth: sub.keysAuth, p256dh: sub.keysP256dh },
    }
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload))
      sent += 1
    } catch (error) {
      const status = (error as { statusCode?: number })?.statusCode
      if (status === 404 || status === 410) {
        // Suscripción ya no válida (cliente desinstaló/expiró) → podar.
        await db
          .delete(webPushSubscriptions)
          .where(eq(webPushSubscriptions.endpoint, sub.endpoint))
          .run()
      } else {
        console.error(`[push] falló a ${sub.endpoint}:`, (error as Error)?.message ?? error)
      }
    }
  }

  return { sent, total: subs.length }
}