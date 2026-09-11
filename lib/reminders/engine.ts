import { db } from '@/lib/db'
import { nodes, notifications } from '@/lib/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { getWorkspaceRecipients, getWorkspaceSlug } from '@/lib/reminders/members'
import { sendPushToWorkspace } from '@/lib/push/send'
import { sendProactiveTelegramToUsers } from '@/lib/telegram/notify'

// ============================================================
// Sweeper de recordatorios (Fase 3)
//
// Recorre los nodos con dueDate que aún no fueron notificados
// (notifiedAt = NULL) y cuyo momento de recordatorio ya llegó:
//     remindAt = dueDate - reminderOffsetMin * 60_000   (offset null → 0)
//
// Para cada nodo vencido (una sola vez, idempotente):
//   1. marca notifiedAt = now (re-claim atómico vía UPDATE ... WHERE IS NULL)
//   2. inserta una notificación in-app por miembro del workspace
//   3. envía Web Push a todos los miembros con suscripción
//   4. envía Telegram proactivo a todos los chats de cuentas de miembros
//
// El diseño es seguro: si un proceso no llega a notificar (crash), el
// notifiedAt ya quedó marcado y no se re-envía; si la app crashea ANTES
// de marcar, el nodo se reintenta en el siguiente sweep.
// ============================================================

const MS_PER_MIN = 60_000

export function reminderAtMs(node: { dueDate: Date | null; reminderOffsetMin: number | null }): number | null {
  if (!node.dueDate) return null
  const offset = node.reminderOffsetMin ?? 0
  return node.dueDate.getTime() - offset * MS_PER_MIN
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function formatDueDate(date: Date): string {
  return date.toLocaleString('es-ES', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Recurrencia (F5.3): aritmética simple con Date nativo. Caso límite
// conocido: monthly sobre fin de mes usa el comportamiento nativo de
// setMonth (puede saltar al mes siguiente) — aceptado para el MVP.
export function advanceDueDate(current: Date, rule: string): Date {
  const next = new Date(current)
  if (rule === 'daily') next.setDate(next.getDate() + 1)
  else if (rule === 'weekly') next.setDate(next.getDate() + 7)
  else next.setMonth(next.getMonth() + 1)
  return next
}

const RECURRENCE_LABELS: Record<string, string> = {
  daily: 'cada día',
  weekly: 'cada semana',
  monthly: 'cada mes',
}

export async function runReminderSweep(now = new Date()): Promise<{ reminded: number }> {
  const candidates = await db
    .select()
    .from(nodes)
    .where(and(isNull(nodes.deletedAt), isNull(nodes.notifiedAt)))
    .all()

  const due: typeof candidates = []
  for (const node of candidates) {
    if (!node.dueDate) continue
    const at = reminderAtMs(node)
    if (at !== null && at <= now.getTime()) due.push(node)
  }

  // Orden: primero lo que vence antes (más urgente).
  due.sort((a, b) => (reminderAtMs(a) ?? 0) - (reminderAtMs(b) ?? 0))

  let reminded = 0
  for (const node of due) {
    if (!node.dueDate) continue
    // Re-claim atómico: solo el sweep que gane la UPDATE (notifiedAt era NULL) notifica.
    const [claimed] = await db
      .update(nodes)
      .set({ notifiedAt: now })
      .where(and(eq(nodes.id, node.id), isNull(nodes.notifiedAt)))
      .returning()
    if (!claimed) continue

    // Recurrencia (F5.3): solo se llega aquí tras ganar el re-claim atómico,
    // así que no hay ventana de carrera nueva. El nodo vuelve a ser candidato
    // en el siguiente sweep (notifiedAt vuelve a NULL).
    if (claimed.recurrenceRule && claimed.dueDate) {
      const nextDueDate = advanceDueDate(claimed.dueDate, claimed.recurrenceRule)
      await db
        .update(nodes)
        .set({ dueDate: nextDueDate, notifiedAt: null })
        .where(eq(nodes.id, claimed.id))
        .run()
    }

    const memberIds = await getWorkspaceRecipients(node.workspaceId)
    const title = '⏰ Recordatorio'
    const body = claimed.recurrenceRule
      ? `"${node.title}" vence ${formatDueDate(node.dueDate)} (↻ se repite ${RECURRENCE_LABELS[claimed.recurrenceRule] ?? claimed.recurrenceRule})`
      : `"${node.title}" vence ${formatDueDate(node.dueDate)}`

    if (memberIds.length > 0) {
      await db
        .insert(notifications)
        .values(
          memberIds.map((userId) => ({
            id: uuidv4(),
            userId,
            workspaceId: node.workspaceId,
            nodeId: node.id,
            kind: 'reminder' as const,
            title,
            body,
          }))
        )
        .run()
    }

    const slug = await getWorkspaceSlug(node.workspaceId)
    await sendPushToWorkspace(node.workspaceId, {
      title,
      body,
      url: slug ? `/w/${slug}` : undefined,
    })

    const telegramText =
      `🔔 <b>Recordatorio</b>\n` +
      `<b>${escapeHtml(node.title)}</b> vence ${escapeHtml(formatDueDate(node.dueDate))}.`
    await sendProactiveTelegramToUsers(memberIds, telegramText)

    reminded += 1
  }

  return { reminded }
}

// ============================================================
// Arranque del sweeper periódico (Next.js instrumentation)
// ============================================================

const SWEEP_INTERVAL_MS = 60_000

declare global {
  // eslint-disable-next-line no-var
  var __canviagramReminderSweeperStarted__: boolean | undefined
}

export function startReminderSweeper(): void {
  if (globalThis.__canviagramReminderSweeperStarted__) return
  globalThis.__canviagramReminderSweeperStarted__ = true

  setInterval(() => {
    runReminderSweep().catch((error) =>
      console.error('[reminders] sweep falló:', (error as Error)?.message ?? error)
    )
  }, SWEEP_INTERVAL_MS)
}