import { db } from '@/lib/db'
import { telegramChats } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'

export type TelegramBinding = typeof telegramChats.$inferSelect

// Ops DB sobre telegram_chats — todas por PK (telegramChatId, telegramUserId).
// Fase 1: el chat se vincula a una CUENTA (userId) y opera sobre el workspace
// activo (activeWorkspaceId). El bot NUNCA recibe el id de workspace del texto.

export async function findBinding(chatId: string, tgUserId: string): Promise<TelegramBinding | null> {
  const row = await db
    .select()
    .from(telegramChats)
    .where(and(eq(telegramChats.telegramChatId, chatId), eq(telegramChats.telegramUserId, tgUserId)))
    .get()
  return row ?? null
}

/**
 * Vincula (o re-vincula) un chat a una CUENTA. `workspaceId` es el workspace que
 * queda ACTIVO tras el /link, o null en vínculo global (el usuario elige con /lista).
 */
export async function upsertBinding(
  chatId: string,
  tgUserId: string,
  claim: { userId: string; workspaceId: string | null },
  createdAt?: Date
): Promise<void> {
  const existing = await findBinding(chatId, tgUserId)
  const now = new Date()
  if (existing) {
    await db
      .update(telegramChats)
      .set({ userId: claim.userId, activeWorkspaceId: claim.workspaceId, lastActivityAt: now })
      .where(and(eq(telegramChats.telegramChatId, chatId), eq(telegramChats.telegramUserId, tgUserId)))
  } else {
    await db.insert(telegramChats).values({
      telegramChatId: chatId,
      telegramUserId: tgUserId,
      userId: claim.userId,
      activeWorkspaceId: claim.workspaceId,
      lastActivityAt: now,
      createdAt: createdAt ?? now,
    })
  }
}

/** Cambia el workspace activo del chat (comando /usar <slug>). */
export async function setActiveWorkspace(
  chatId: string,
  tgUserId: string,
  workspaceId: string
): Promise<void> {
  await db
    .update(telegramChats)
    .set({ activeWorkspaceId: workspaceId, lastActivityAt: new Date() })
    .where(and(eq(telegramChats.telegramChatId, chatId), eq(telegramChats.telegramUserId, tgUserId)))
}

/** Deja el chat sin workspace activo (membresía revocada o workspace borrado). */
export async function resetActiveWorkspace(chatId: string, tgUserId: string): Promise<void> {
  await db
    .update(telegramChats)
    .set({ activeWorkspaceId: null, lastActivityAt: new Date() })
    .where(and(eq(telegramChats.telegramChatId, chatId), eq(telegramChats.telegramUserId, tgUserId)))
}

/** Touch "vivo": cada mensaje procesado por el bot actualiza lastActivityAt. */
export async function touchLastActivity(chatId: string, tgUserId: string): Promise<void> {
  await db
    .update(telegramChats)
    .set({ lastActivityAt: new Date() })
    .where(and(eq(telegramChats.telegramChatId, chatId), eq(telegramChats.telegramUserId, tgUserId)))
}

export async function deleteBinding(chatId: string, tgUserId: string): Promise<void> {
  await db
    .delete(telegramChats)
    .where(and(eq(telegramChats.telegramChatId, chatId), eq(telegramChats.telegramUserId, tgUserId)))
}

/** Chats vinculados a una cuenta (para /estado desde el chat). */
export async function listBindingsByUser(userId: string): Promise<TelegramBinding[]> {
  return db.select().from(telegramChats).where(eq(telegramChats.userId, userId))
}

/** Chats cuyo workspace ACTIVO es `workspaceId` (estado de un workspace). */
export async function listChatsByActiveWorkspace(workspaceId: string): Promise<TelegramBinding[]> {
  return db.select().from(telegramChats).where(eq(telegramChats.activeWorkspaceId, workspaceId))
}

/**
 * Chats vinculados a un conjunto de cuentas (los miembros de un workspace).
 * Fase 3: Telegram proactivo llega a TODOS los chats de miembros, sin importar
 * el workspace activo.
 */
export async function listChatsForUsers(userIds: string[]): Promise<TelegramBinding[]> {
  if (userIds.length === 0) return []
  return db.select().from(telegramChats).where(inArray(telegramChats.userId, userIds))
}

/**
 * Borra los bindings cuyo workspace ACTIVO es `workspaceId`.
 * @deprecated En modelo global no borrar la cuenta: usar resetActiveWorkspacesByWorkspace.
 * Se mantiene por compat con tests/wrappers legacy.
 */
export async function deleteBindingsByWorkspace(workspaceId: string): Promise<void> {
  await db.delete(telegramChats).where(eq(telegramChats.activeWorkspaceId, workspaceId))
}

/** Borra TODOS los bindings de una cuenta (unlink global desde la web). */
export async function deleteBindingsByUser(userId: string): Promise<number> {
  const rows = await db.select().from(telegramChats).where(eq(telegramChats.userId, userId))
  await db.delete(telegramChats).where(eq(telegramChats.userId, userId))
  return rows.length
}

/**
 * Quita el workspace ACTIVO sin borrar la cuenta (borrado de workspace o
 * desvinculación por workspace legacy). El vínculo global sobrevive con activo null.
 */
export async function resetActiveWorkspacesByWorkspace(workspaceId: string): Promise<void> {
  await db
    .update(telegramChats)
    .set({ activeWorkspaceId: null, lastActivityAt: new Date() })
    .where(eq(telegramChats.activeWorkspaceId, workspaceId))
}