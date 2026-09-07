import { and, desc, eq, notInArray, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/lib/db'
import {
  chatMessages,
  CHAT_MESSAGES_CAP,
  type ChatSource,
} from '@/lib/db/schema'
import type { ChatMessage } from '@/lib/chat/types'

// ============================================================
// Claves de conversación
// - web:      userId (1 chat por usuario por workspace)
// - telegram: `tg:<telegramChatId>:<telegramUserId>`
// ============================================================

export function buildWebChatKey(userId: string): string {
  return userId
}

export function buildTelegramChatKey(telegramChatId: string, telegramUserId: string): string {
  return `tg:${telegramChatId}:${telegramUserId}`
}

export type PersistedChatMessage = {
  id: string
  role: ChatMessage['role']
  content: string
  createdAt: Date
}

export type ListChatMessagesOptions = {
  workspaceId: string
  chatKey: string
  /** Máximo a devolver (default CHAT_MESSAGES_CAP). Orden cronológico (más antigua primero). */
  limit?: number
}

export async function listChatMessages({
  workspaceId,
  chatKey,
  limit = CHAT_MESSAGES_CAP,
}: ListChatMessagesOptions): Promise<PersistedChatMessage[]> {
  const rows = await db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.workspaceId, workspaceId), eq(chatMessages.chatKey, chatKey)))
    .orderBy(desc(chatMessages.createdAt), desc(sql`rowid`))
    .limit(limit)
    .all()

  return rows.reverse().map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt,
  }))
}

export type AppendChatMessagesOptions = {
  workspaceId: string
  chatKey: string
  source: ChatSource
  messages: ChatMessage[]
}

/**
 * Persiste mensajes en orden. Valida shape mínima (defensa en profundidad,
 * la validación fuerte vive en Zod del route/bot). NO aplica cap aquí:
 * llamar trimChatMessages después de append.
 */
export async function appendChatMessages({
  workspaceId,
  chatKey,
  source,
  messages,
}: AppendChatMessagesOptions): Promise<PersistedChatMessage[]> {
  const rows = messages.map((m) => ({
    id: uuidv4(),
    workspaceId,
    chatKey,
    source,
    role: m.role,
    content: m.content,
  }))

  await db.insert(chatMessages).values(rows)

  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: new Date(),
  }))
}

/**
 * Barre los mensajes más antiguos de un chatKey hasta dejar los CHAT_MESSAGES_CAP
 * más recientes. Borra por exclusión: conserva el id de los N más recientes y
 * elimina todo lo demás. Retorna cuántos borró.
 */
export async function trimChatMessages(workspaceId: string, chatKey: string): Promise<number> {
  const keep = await db
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(and(eq(chatMessages.workspaceId, workspaceId), eq(chatMessages.chatKey, chatKey)))
    .orderBy(desc(chatMessages.createdAt), desc(sql`rowid`))
    .limit(CHAT_MESSAGES_CAP)
    .all()

  if (keep.length === 0) return 0

  const keepIds = keep.map((row) => row.id)
  const result = await db
    .delete(chatMessages)
    .where(
      and(
        eq(chatMessages.workspaceId, workspaceId),
        eq(chatMessages.chatKey, chatKey),
        notInArray(chatMessages.id, keepIds)
      )
    )

  return result.changes ?? 0
}

export type AppendAndTrimChatMessagesOptions = AppendChatMessagesOptions

/**
 * append + trim en un solo paso, con cap garantizado de CHAT_MESSAGES_CAP.
 * Es el único punto de escritura que usan web y Telegram.
 */
export async function appendAndTrimChatMessages(options: AppendAndTrimChatMessagesOptions): Promise<PersistedChatMessage[]> {
  const appended = await appendChatMessages(options)
  await trimChatMessages(options.workspaceId, options.chatKey)
  return appended
}

export async function clearChatMessages(workspaceId: string, chatKey: string): Promise<void> {
  await db
    .delete(chatMessages)
    .where(and(eq(chatMessages.workspaceId, workspaceId), eq(chatMessages.chatKey, chatKey)))
}