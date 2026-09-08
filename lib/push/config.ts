import webpush from 'web-push'
import { env } from '@/lib/env'

// ============================================================
// Config de Web Push (Fase 3)
//
// Guard: el push solo está habilitado si existen VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY y VAPID_SUBJECT. Sin ellos, sendPushToWorkspace
// se convierte en no-op (la campana in-app y Telegram siguen activos).
// ============================================================

const subject = env.VAPID_SUBJECT ?? 'mailto:canviagram@example.com'

export function isPushEnabled(): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT)
}

export function getVapidPublicKey(): string | null {
  return env.VAPID_PUBLIC_KEY ?? null
}

// Configura webpush de forma idempotente (guard por flag para no re-setear en hot reload).
let configured = false
export function ensureVapidConfigured(): boolean {
  if (!isPushEnabled()) return false
  if (!configured) {
    webpush.setVapidDetails(subject, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!)
    configured = true
  }
  return true
}