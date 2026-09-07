import { Bot, type Context } from 'grammy'
import { generateText } from 'ai'
import { eq } from 'drizzle-orm'
import { workspaces, CHAT_MESSAGE_MAX_CONTENT } from '@/lib/db/schema'
import { db } from '@/lib/db'
import { telegramBotToken } from '@/lib/telegram/config'
import { consumeLinkCode } from '@/lib/telegram/link-store'
import { findBinding, upsertBinding, deleteBinding } from '@/lib/telegram/chats'
import { isAIEnabled, getLLM } from '@/lib/ai/provider'
import { createNode, getWorkspaceGraph } from '@/lib/canvas-service'
import { ValidationError, ForbiddenError } from '@/lib/errors'
import { parseTelegramNode } from '@/lib/telegram/parse'
import {
  buildTelegramChatKey,
  listChatMessages,
  appendAndTrimChatMessages,
  clearChatMessages,
} from '@/lib/chat/repository'

// ============================================================
// Helpers puros (exportados para tests — diseño F4.2 §4.1 N4)
// ============================================================

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const KNOWN_COMMANDS = new Set(['start', 'help', 'ayuda', 'link', 'unlink'])

export type ParsedCommand =
  | { kind: 'command'; name: string; args: string[] }
  | { kind: 'plain' }

// Comandos desconocidos → plain (el handler responde "/ayuda para ver comandos" sin LLM).
// Args normalizados: trim + uppercase (diseño F4.2 §7.2).
export function parseCommand(text: string | undefined): ParsedCommand {
  if (!text || !text.startsWith('/')) return { kind: 'plain' }
  const [rawName, ...rawArgs] = text.slice(1).split(/\s+/)
  const name = rawName?.toLowerCase() ?? ''
  if (!KNOWN_COMMANDS.has(name)) return { kind: 'plain' }
  return { kind: 'command', name, args: rawArgs.map((a) => a.trim().toUpperCase()).filter(Boolean) }
}

// ============================================================
// Dedupe update_id (ring-buffer, diseño F4.2 §5.1)
// ============================================================

const MAX_DEDUPE_IDS = 2000
const recentUpdateIds = new Set<number>()
const updateIdQueue: number[] = []

export function isDuplicateUpdate(updateId: number): boolean {
  if (recentUpdateIds.has(updateId)) return true
  recentUpdateIds.add(updateId)
  updateIdQueue.push(updateId)
  if (updateIdQueue.length > MAX_DEDUPE_IDS) {
    const oldest = updateIdQueue.shift()
    if (oldest !== undefined) recentUpdateIds.delete(oldest)
  }
  return false
}

// Solo para tests (aislamiento entre casos).
export function _resetDedupe(): void {
  recentUpdateIds.clear()
  updateIdQueue.length = 0
}

// ============================================================
// Memoria breve del chat (diseño f4.4): últimos mensajes persistidos
// en chat_messages (source=telegram); se borra en /unlink.
// ============================================================

const TELEGRAM_MEMORY_MAX = 8
const TELEGRAM_MEMORY_MAX_CONTENT = 300

function formatMemory(messages: Array<{ role: 'user' | 'assistant'; content: string }>): string {
  const recent = messages.slice(-TELEGRAM_MEMORY_MAX)
  if (recent.length === 0) return '(sin conversación previa en este chat)'
  return recent
    .map((m) => {
      const content =
        m.content.length > TELEGRAM_MEMORY_MAX_CONTENT
          ? `${m.content.slice(0, TELEGRAM_MEMORY_MAX_CONTENT)}…`
          : m.content
      return `${m.role === 'user' ? 'usuario' : 'asistente'}: ${content}`
    })
    .join('\n')
}

async function persistTelegramTurn(
  workspaceId: string,
  chatKey: string,
  userText: string,
  assistantText: string
): Promise<void> {
  const user = userText.trim().slice(0, CHAT_MESSAGE_MAX_CONTENT)
  const assistant = assistantText.trim().slice(0, CHAT_MESSAGE_MAX_CONTENT)
  if (!user && !assistant) return
  await appendAndTrimChatMessages({
    workspaceId,
    chatKey,
    source: 'telegram',
    messages: [
      { role: 'user', content: user },
      { role: 'assistant', content: assistant },
    ],
  })
}

// ============================================================
// System prompt (diseño F4.2 §2.4) — resumen idéntico a F3.2
// ============================================================

function buildTelegramSystemPrompt(
  workspaceName: string,
  graph: { nodes: Array<{ id: string; type: string; title: string; status: string | null }>; edges: Array<{ sourceId: string; targetId: string; type: string; label: string | null }> },
  memory: Array<{ role: 'user' | 'assistant'; content: string }>
): string {
  const nodeSummary = graph.nodes
    .slice(0, 50)
    .map((n) => `- [${n.type}] "${n.title}" (id: ${n.id}${n.status ? `, status: ${n.status}` : ''})`)
    .join('\n')

  const edgeSummary = graph.edges
    .slice(0, 50)
    .map((e) => `- ${e.sourceId} --[${e.type}]--> ${e.targetId}${e.label ? ` ("${e.label}")` : ''}`)
    .join('\n')

  return `Eres el asistente de Canviagram en Telegram para el workspace «${workspaceName}».
Operas sobre el canvas real del usuario (el mensaje viene de un chat vinculado).

## Estado actual del workspace
Nodos:
${nodeSummary || '(ninguno)'}

Conexiones:
${edgeSummary || '(ninguna)'}

## Conversación reciente en este chat
${formatMemory(memory)}

## Reglas
- Decide si el mensaje intenta crear un nodo en el canvas. Si sí: shouldCreate=true y
  rellena node con type (project|task|note|idea|person|resource), title, content opcional,
  status SOLO si type=task. La posición la asigna el sistema: NO la generes ni la pidas.
- Si es saludo, pregunta o tema fuera del canvas: shouldCreate=false y un reply corto.
- No inventes IDs de nodos ni menciones datos de otros workspaces.
- Responde SIEMPRE en JSON plano con el shape: {"shouldCreate":boolean,"node":{...}|null,"reply":string|null}
- Responde en español unless the user writes in English.`
}

// ============================================================
// Handlers (diseño F4.2 §5.3)
// ============================================================

// Interfaz mínima para poder testear los handlers sin grammY.
export interface TelegramReplyCtx {
  chatId: string
  tgUserId: string
  reply(text: string, other?: { parse_mode?: 'HTML' }): Promise<unknown>
}

async function getWorkspaceName(workspaceId: string): Promise<string> {
  const row = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, workspaceId)).get()
  return row?.name ?? 'workspace'
}

export async function handleLink(ctx: TelegramReplyCtx, code: string): Promise<void> {
  const result = consumeLinkCode(code)
  if (!result.ok) {
    await ctx.reply('❌ Código inválido o expirado. Genera uno nuevo en Ajustes → Telegram (válido por 10 minutos).', {
      parse_mode: 'HTML',
    })
    return
  }

  await upsertBinding(ctx.chatId, ctx.tgUserId, { workspaceId: result.workspaceId, userId: result.userId })
  const name = await getWorkspaceName(result.workspaceId)
  await ctx.reply(`✅ Vinculado a «${escapeHtml(name)}»\nEnvía un mensaje para crear nodos en el canvas.`, {
    parse_mode: 'HTML',
  })
}

export async function handleUnlink(ctx: TelegramReplyCtx): Promise<void> {
  const binding = await findBinding(ctx.chatId, ctx.tgUserId)
  if (!binding) {
    await ctx.reply('No hay un workspace vinculado a este chat.', { parse_mode: 'HTML' })
    return
  }
  await deleteBinding(ctx.chatId, ctx.tgUserId)
  // Borrar también la memoria del chat (privacidad: /unlink = reset total).
  await clearChatMessages(binding.workspaceId, buildTelegramChatKey(ctx.chatId, ctx.tgUserId))
  await ctx.reply('🔓 Chat desvinculado del workspace.', { parse_mode: 'HTML' })
}

export async function handleMessage(ctx: TelegramReplyCtx, text: string): Promise<void> {
  // Frontera de seguridad: el workspaceId/userId vienen SOLO de la fila telegram_chats
  // hallada por (chat.id, from.id) — nunca del texto del mensaje (diseño F4.2 §2.2).
  const binding = await findBinding(ctx.chatId, ctx.tgUserId)
  if (!binding) {
    await ctx.reply('Este chat no está vinculado a ningún workspace. Vincula tu chat en Ajustes → Telegram y usa /link CÓDIGO.', {
      parse_mode: 'HTML',
    })
    return
  }

  if (!isAIEnabled()) {
    await ctx.reply('La IA está deshabilitada. Configura AI_API_KEY en .env para crear nodos desde Telegram.', {
      parse_mode: 'HTML',
    })
    return
  }

  let graph: Awaited<ReturnType<typeof getWorkspaceGraph>>
  let workspaceName: string
  try {
    ;[graph, workspaceName] = await Promise.all([
      getWorkspaceGraph(binding.workspaceId, binding.userId),
      getWorkspaceName(binding.workspaceId),
    ])
  } catch (error) {
    if (error instanceof ForbiddenError) {
      await ctx.reply('Sin permisos para crear nodos en este workspace.', { parse_mode: 'HTML' })
      return
    }
    throw error
  }

  const chatKey = buildTelegramChatKey(ctx.chatId, ctx.tgUserId)
  const memory = await listChatMessages({ workspaceId: binding.workspaceId, chatKey, limit: TELEGRAM_MEMORY_MAX })

  // generateText + parse Zod local (F4.2 f4.5): sin AI_NoObjectGeneratedError.
  const { text: raw } = await generateText({
    model: getLLM(),
    system: buildTelegramSystemPrompt(workspaceName, graph, memory),
    prompt: text.slice(0, 4000),
  })

  const parsed = parseTelegramNode(raw)
  if (!parsed) {
    await ctx.reply('No pude interpretar tu mensaje. Intenta de nuevo con una instrucción más clara.', {
      parse_mode: 'HTML',
    })
    return
  }

  if (parsed.shouldCreate && parsed.node) {
    let assistantText = ''
    try {
      const node = await createNode(binding.workspaceId, binding.userId, parsed.node)
      assistantText = `Nodo creado: ${node.title} (${node.type} · ${node.id})`
      await ctx.reply(`✅ Nodo creado: <b>${escapeHtml(node.title)}</b> (${node.type} · ${node.id})`, {
        parse_mode: 'HTML',
      })
    } catch (error) {
      if (error instanceof ValidationError) {
        assistantText = `No pude crear el nodo: ${error.message}`
        await ctx.reply(`No pude crear el nodo: ${escapeHtml(error.message)}`, { parse_mode: 'HTML' })
      } else if (error instanceof ForbiddenError) {
        assistantText = 'Sin permisos para crear nodos en este workspace.'
        await ctx.reply('Sin permisos para crear nodos en este workspace.', { parse_mode: 'HTML' })
      } else {
        throw error
      }
    }
    await persistTelegramTurn(binding.workspaceId, chatKey, text, assistantText)
    return
  }

  if (parsed.reply) {
    await persistTelegramTurn(binding.workspaceId, chatKey, text, parsed.reply)
    await ctx.reply(escapeHtml(parsed.reply), { parse_mode: 'HTML' })
  }
}

// ============================================================
// Wiring grammY (diseño F4.2 §4.1 N4)
// ============================================================

function toReplyCtx(ctx: Context): TelegramReplyCtx {
  return {
    chatId: String(ctx.chat?.id ?? ''),
    tgUserId: String(ctx.from?.id ?? ''),
    reply: (text, other) => ctx.reply(text, other),
  }
}

export function registerHandlers(bot: Bot): void {
  // bot.catch: log update_id + err.message (nunca el update completo) + reply genérico.
  bot.catch((err) => {
    console.error(`[telegram] update ${err.ctx.update.update_id} falló: ${err.message}`)
    try {
      void err.ctx.reply('Ups, algo falló. Inténtalo de nuevo.', { parse_mode: 'HTML' })
    } catch {
      // reply no disponible — solo log
    }
  })

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text
    const parsed = parseCommand(text)
    const replyCtx = toReplyCtx(ctx)

    if (parsed.kind === 'command') {
      switch (parsed.name) {
        case 'start':
          await ctx.reply(
            'Hola 👋\nSoy el asistente de Canviagram.\nVincula tu chat en Ajustes → Telegram y usa /link CÓDIGO. Escribe /ayuda para ver comandos.',
            { parse_mode: 'HTML' }
          )
          return
        case 'help':
        case 'ayuda':
          await ctx.reply(
            'Comandos:\n/link CÓDIGO — vincula este chat a un workspace\n/unlink — desvincula este chat\nEnvía un mensaje normal para crear nodos con IA.',
            { parse_mode: 'HTML' }
          )
          return
        case 'link': {
          const code = parsed.args[0]
          if (!code) {
            await ctx.reply('Uso: /link CÓDIGO. Genera un código en Ajustes → Telegram.', { parse_mode: 'HTML' })
            return
          }
          await handleLink(replyCtx, code)
          return
        }
        case 'unlink':
          await handleUnlink(replyCtx)
          return
      }
      return
    }

    // Comando desconocido → reply sin LLM (diseño F4.2 §5.3).
    if (text.startsWith('/')) {
      await ctx.reply('/ayuda para ver comandos', { parse_mode: 'HTML' })
      return
    }

    await handleMessage(replyCtx, text)
  })
}

// botInfo stub: evita getMe() en runtime (diseño F4.2 §4.1 N4).
// Campos requeridos por UserFromGetMe (grammy 1.46 / @grammyjs/types 5.0).
const BOT_INFO_STUB = {
  id: 0,
  is_bot: true,
  username: 'canviagram_bot',
  first_name: 'Canviagram',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
} as const

export function createTelegramBot(tokenOverride?: string): Bot {
  const token = tokenOverride ?? telegramBotToken()
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN no configurado')
  const bot = new Bot(token, { botInfo: BOT_INFO_STUB })
  registerHandlers(bot)
  return bot
}

let botSingleton: Bot | null = null

export function getBot(): Bot {
  if (!botSingleton) botSingleton = createTelegramBot()
  return botSingleton
}