import { vi } from 'vitest'
import type { Update } from 'grammy/types'

// Ids fijos para fixtures (diseño F4.2 §4.1 N7)
export const FIXED_CHAT_ID = 111
export const FIXED_USER_ID = 222

export function makeUpdate(
  input: {
    chatId?: number
    userId?: number
    text?: string
    chatType?: 'private' | 'group' | 'supergroup'
    updateId?: number
  } = {}
): Update {
  const chatId = input.chatId ?? FIXED_CHAT_ID
  const chatType = input.chatType ?? 'private'
  const chat =
    chatType === 'private'
      ? { id: chatId, type: 'private' as const, first_name: 'Test User' }
      : chatType === 'group'
        ? { id: chatId, type: 'group' as const, title: 'Test Group' }
        : { id: chatId, type: 'supergroup' as const, title: 'Test Group' }
  return {
    update_id: input.updateId ?? 1,
    message: {
      message_id: 1,
      date: 0,
      chat,
      from: { id: input.userId ?? FIXED_USER_ID, is_bot: false, first_name: 'T' },
      text: input.text,
    },
  }
}

export function makeCtxStub(overrides?: { chatId?: string; tgUserId?: string }) {
  return {
    chatId: overrides?.chatId ?? String(FIXED_CHAT_ID),
    tgUserId: overrides?.tgUserId ?? String(FIXED_USER_ID),
    reply: vi.fn().mockResolvedValue(undefined),
  }
}

// Update con callback_query (botones inline "usar:<uuid>", 41B).
export function makeCallbackUpdate(
  input: {
    chatId?: number
    userId?: number
    data?: string
    updateId?: number
    callbackId?: string
  } = {}
): Update {
  const chatId = input.chatId ?? FIXED_CHAT_ID
  return {
    update_id: input.updateId ?? 2,
    callback_query: {
      id: input.callbackId ?? 'cb-1',
      from: { id: input.userId ?? FIXED_USER_ID, is_bot: false, first_name: 'T' },
      message: {
        message_id: 1,
        date: 0,
        chat: { id: chatId, type: 'private' as const, first_name: 'Test User' },
        text: 'Elige el workspace activo:',
      },
      chat_instance: 'test-instance',
      data: input.data ?? 'usar:00000000-0000-0000-0000-000000000000',
    },
  }
}

export function makeCallbackCtxStub(overrides?: {
  chatId?: string
  tgUserId?: string
  callbackData?: string
}) {
  return {
    chatId: overrides?.chatId ?? String(FIXED_CHAT_ID),
    tgUserId: overrides?.tgUserId ?? String(FIXED_USER_ID),
    callbackData: overrides?.callbackData ?? 'usar:00000000-0000-0000-0000-000000000000',
    answerCallback: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
  }
}