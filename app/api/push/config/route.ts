export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { isPushEnabled, getVapidPublicKey } from '@/lib/push/config'

// ============================================================
// GET /api/push/config — configuración de push para el cliente (Fase 3)
//
// La clave pública VAPID es pública (no es secreto); el navegador la
// necesita para crear la suscripción (applicationServerKey).
// ============================================================

export async function GET() {
  return NextResponse.json({
    enabled: isPushEnabled(),
    vapidPublicKey: getVapidPublicKey(),
  })
}