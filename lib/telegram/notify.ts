import { getBot } from '@/lib/telegram/bot'
import { isTelegramEnabled } from '@/lib/telegram/config'
import { listChatsForUsers } from '@/lib/telegram/chats'

// ============================================================
// Telegram proactivo (Fase 3)
//
// Envía un mensaje HTML a TODOS los chats vinculados a las cuentas
// de los miembros del workspace, SIN importar el workspace activo
// del chat (listChatsForUsers). El sweeper de recordatorios lo usa
// para avisar por Telegram además de la campana in-app y el push.
// No lanza errores: best-effort.
// ============================================================

export async function sendProactiveTelegramToUsers(userIds: string[], text: string) {
  if (!isTelegramEnabled()) return { sent: 0 }
  const chats = await listChatsForUsers(userIds)

  let sent = 0
  for (const chat of chats) {
    try {
      await getBot().api.sendMessage(chat.telegramChatId, text, { parse_mode: 'HTML' })
      sent += 1
    } catch (error) {
      console.error(
        `[telegram] proactivo a ${chat.telegramChatId} falló:`,
        (error as Error)?.message ?? error
      )
    }
  }
  return { sent }
}