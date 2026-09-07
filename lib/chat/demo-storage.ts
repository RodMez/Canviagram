import type { ChatMessage } from '@/lib/chat/types'
import { CHAT_MESSAGES_CAP } from '@/lib/db/schema'

export const DEMO_CHAT_STORAGE_KEY = 'canviagram.chat.demo'

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (record.role === 'user' || record.role === 'assistant') && typeof record.content === 'string'
}

/**
 * Carga el historial demo desde localStorage. Nunca revienta: ante cualquier
 * problema devuelve [].
 */
export function loadDemoChatMessages(): ChatMessage[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(DEMO_CHAT_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isChatMessage).slice(-CHAT_MESSAGES_CAP)
  } catch {
    return []
  }
}

export function saveDemoChatMessages(messages: ChatMessage[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(DEMO_CHAT_STORAGE_KEY, JSON.stringify(messages.slice(-CHAT_MESSAGES_CAP)))
  } catch {
    // Almacenamiento no disponible (privacy mode) — el demo sigue en memoria.
  }
}

export function clearDemoChatMessages(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(DEMO_CHAT_STORAGE_KEY)
  } catch {
    // sin-op
  }
}