export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { runReminderSweep } from '@/lib/reminders/engine'

// ============================================================
// POST /api/reminders/run — disparo manual del sweeper (Fase 3)
//
// Endpoint para cron/externos. Requiere el header X-Reminder-Sweep-Secret
// que coincida con REMINDER_SWEEP_SECRET. Si no está configurado el secret,
// devuelve 503 (sweeper desactivado por configuración).
// ============================================================

const SWEEP_SECRET_HEADER = 'x-reminder-sweep-secret'

export async function POST(request: Request) {
  if (!env.REMINDER_SWEEP_SECRET) {
    return NextResponse.json({ error: 'Sweeper no configurado' }, { status: 503 })
  }

  const provided = request.headers.get(SWEEP_SECRET_HEADER)
  if (provided !== env.REMINDER_SWEEP_SECRET) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const { reminded } = await runReminderSweep()
    return NextResponse.json({ ok: true, reminded })
  } catch (error) {
    console.error('[reminders] run falló:', (error as Error)?.message ?? error)
    return NextResponse.json({ error: 'Error ejecutando el sweeper' }, { status: 500 })
  }
}