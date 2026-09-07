import { z } from 'zod'
import { CHAT_MESSAGE_MAX_CONTENT } from '@/lib/db/schema'

export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant'], {
    message: 'role debe ser user o assistant',
  }),
  content: z
    .string()
    .trim()
    .min(1, 'El mensaje no puede estar vacío')
    .max(CHAT_MESSAGE_MAX_CONTENT, `El mensaje no puede exceder ${CHAT_MESSAGE_MAX_CONTENT} caracteres`),
})

/**
 * Transport del cliente: máx 100 por request. El repositorio capa a
 * CHAT_MESSAGES_CAP por chatKey al persistir.
 */
export const persistChatMessagesSchema = z.object({
  messages: z.array(chatMessageSchema).min(1, 'Debe enviar al menos un mensaje').max(100, 'Demasiados mensajes en un request'),
})

export type PersistChatMessagesInput = z.infer<typeof persistChatMessagesSchema>