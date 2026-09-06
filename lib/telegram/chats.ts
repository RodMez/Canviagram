import { db } from '@/lib/db'
import { telegramChats } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export type TelegramBinding = typeof telegramChats.$inferSelect

// Ops DB sobre telegram_chats — todas por PK (telegramChatId, telegramUserId).
// Diseño F4.2 §5.5: read-check-then-write (SELECT por PK → UPDATE si existe, INSERT si no).

export async function findBinding(chatId: string, tgUserId: string): Promise<TelegramBinding | null> {
  const row = await db
    .select()
    .from(telegramChats)
    .where(and(eq(telegramChats.telegramChatId, chatId), eq(telegramChats.telegramUserId, tgUserId)))
    .get()
  return row ?? null
}

export async function upsertBinding(
  chatId: string,
  tgUserId: string,
  claim: { workspaceId: string; userId: string },
  createdAt?: Date
): Promise<void> {
  const existing = await findBinding(chatId, tgUserId)
  if (existing) {
    await db
      .update(telegramChats)
      .set({ workspaceId: claim.workspaceId, userId: claim.userId })
      .where(and(eq(telegramChats.telegramChatId, chatId), eq(telegramChats.telegramUserId, tgUserId)))
  } else {
    await db.insert(telegramChats).values({
      telegramChatId: chatId,
      telegramUserId: tgUserId,
      workspaceId: claim.workspaceId,
      userId: claim.userId,
      createdAt: createdAt ?? new Date(),
    })
  }
}

export async function deleteBinding(chatId: string, tgUserId: string): Promise<void> {
  await db
    .delete(telegramChats)
    .where(and(eq(telegramChats.telegramChatId, chatId), eq(telegramChats.telegramUserId, tgUserId)))
}

/**
 * Borra todos los bindings de Telegram para un workspace.
 * Usado por DELETE /api/workspaces/[id]/telegram/link (diseño F4.3 §7).
 * Índice idx_telegram_workspace ya cubre; FK cascade confirmado.
 */
export async function deleteBindingsByWorkspace(workspaceId: string): Promise<void> {
  await db
    .delete(telegramChats)
    .where(eq(telegramChats.workspaceId, workspaceId))
}