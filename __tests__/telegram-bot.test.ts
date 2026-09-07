import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/lib/db'
import { users, workspaces } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { ValidationError, ForbiddenError } from '@/lib/errors'

vi.mock('@/lib/telegram/chats', () => ({
  findBinding: vi.fn(),
  upsertBinding: vi.fn(),
  deleteBinding: vi.fn(),
}))
vi.mock('@/lib/ai/provider', () => ({
  isAIEnabled: vi.fn(),
  getLLM: vi.fn(),
}))
vi.mock('@/lib/canvas-service', () => ({
  createNode: vi.fn(),
  getWorkspaceGraph: vi.fn(),
}))
vi.mock('@/lib/chat/repository', () => ({
  buildTelegramChatKey: vi.fn((chatId, tgUserId) => `tg:${chatId}:${tgUserId}`),
  listChatMessages: vi.fn().mockResolvedValue([]),
  appendAndTrimChatMessages: vi.fn().mockResolvedValue([]),
  clearChatMessages: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('ai', () => ({
  generateText: vi.fn(),
}))

import { parseCommand, handleLink, handleUnlink, handleMessage, escapeHtml, createTelegramBot } from '@/lib/telegram/bot'
import { createLinkCode, _clear as clearLinkStore } from '@/lib/telegram/link-store'
import { findBinding, upsertBinding, deleteBinding } from '@/lib/telegram/chats'
import { isAIEnabled, getLLM } from '@/lib/ai/provider'
import { createNode, getWorkspaceGraph } from '@/lib/canvas-service'
import { generateText } from 'ai'
import { buildTelegramChatKey, listChatMessages, appendAndTrimChatMessages, clearChatMessages } from '@/lib/chat/repository'
import { makeUpdate, makeCtxStub, FIXED_CHAT_ID, FIXED_USER_ID } from '@/__tests__/helpers/telegram'

const mFindBinding = vi.mocked(findBinding)
const mUpsertBinding = vi.mocked(upsertBinding)
const mDeleteBinding = vi.mocked(deleteBinding)
const mIsAIEnabled = vi.mocked(isAIEnabled)
const mGetLLM = vi.mocked(getLLM)
const mCreateNode = vi.mocked(createNode)
const mGetWorkspaceGraph = vi.mocked(getWorkspaceGraph)
const mGenerateText = vi.mocked(generateText)
const mBuildTelegramChatKey = vi.mocked(buildTelegramChatKey)
const mListChatMessages = vi.mocked(listChatMessages)
const mAppendAndTrimChatMessages = vi.mocked(appendAndTrimChatMessages)
const mClearChatMessages = vi.mocked(clearChatMessages)

const ownerId = uuidv4()
const wsId = uuidv4()

describe('lib/telegram/bot', () => {
  beforeAll(async () => {
    await db.insert(users).values({
      id: ownerId,
      email: `bot-owner-${ownerId.slice(0, 8)}@example.com`,
      passwordHash: 'hash',
      displayName: 'Bot Owner',
      emailVerified: true,
    })
    await db.insert(workspaces).values({
      id: wsId,
      ownerId,
      name: 'Bot WS',
      slug: `bot-ws-${wsId.slice(0, 8)}`,
    })
  })

  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.id, wsId))
    await db.delete(users).where(eq(users.id, ownerId))
  })

  beforeEach(() => {
    vi.clearAllMocks()
    clearLinkStore()
  })

  describe('parseCommand', () => {
    it('/link XYZ2AB9C → comando link con args', () => {
      expect(parseCommand('/link XYZ2AB9C')).toEqual({ kind: 'command', name: 'link', args: ['XYZ2AB9C'] })
    })

    it('/LINK   xyz2   → código normalizado (upper + trim)', () => {
      expect(parseCommand('/LINK   xyz2  ')).toEqual({ kind: 'command', name: 'link', args: ['XYZ2'] })
    })

    it('texto plano → comando nulo', () => {
      expect(parseCommand('hola mundo')).toEqual({ kind: 'plain' })
      expect(parseCommand(undefined)).toEqual({ kind: 'plain' })
    })

    it('/unknown → nulo (comando desconocido)', () => {
      expect(parseCommand('/unknown')).toEqual({ kind: 'plain' })
    })
  })

  describe('handleLink', () => {
    it('ok → upsertBinding con (chatId, tgUserId, claim) y reply de éxito HTML', async () => {
      const { code } = createLinkCode({ workspaceId: wsId, userId: ownerId })
      const ctx = makeCtxStub()

      await handleLink(ctx, code)

      expect(mUpsertBinding).toHaveBeenCalledWith(String(FIXED_CHAT_ID), String(FIXED_USER_ID), {
        workspaceId: wsId,
        userId: ownerId,
      })
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('✅ Vinculado a «Bot WS»'),
        { parse_mode: 'HTML' }
      )
    })

    it('not_found → reply de error y upsertBinding NO llamado', async () => {
      const ctx = makeCtxStub()
      await handleLink(ctx, 'ZZZZZZZZ')
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('❌ Código inválido o expirado'),
        { parse_mode: 'HTML' }
      )
      expect(mUpsertBinding).not.toHaveBeenCalled()
    })

    it('expired → reply de error', async () => {
      vi.useFakeTimers()
      try {
        const { code } = createLinkCode({ workspaceId: wsId, userId: ownerId }, { ttlSeconds: 1 })
        vi.advanceTimersByTime(2000)
        const ctx = makeCtxStub()
        await handleLink(ctx, code)
        expect(ctx.reply).toHaveBeenCalledWith(
          expect.stringContaining('❌ Código inválido o expirado'),
          { parse_mode: 'HTML' }
        )
        expect(mUpsertBinding).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('handleUnlink', () => {
    it('sin binding → reply "no hay workspace vinculado"', async () => {
      mFindBinding.mockResolvedValue(null)
      const ctx = makeCtxStub()
      await handleUnlink(ctx)
      expect(ctx.reply).toHaveBeenCalledWith('No hay un workspace vinculado a este chat.', { parse_mode: 'HTML' })
      expect(mDeleteBinding).not.toHaveBeenCalled()
    })

    it('con binding → deleteBinding por PK y reply de confirmación', async () => {
      mFindBinding.mockResolvedValue({
        telegramChatId: String(FIXED_CHAT_ID),
        telegramUserId: String(FIXED_USER_ID),
        workspaceId: wsId,
        userId: ownerId,
        createdAt: new Date(),
      })
      const ctx = makeCtxStub()
      await handleUnlink(ctx)
      expect(mDeleteBinding).toHaveBeenCalledWith(String(FIXED_CHAT_ID), String(FIXED_USER_ID))
      // /unlink debe borrar también la memoria del chat
      expect(mClearChatMessages).toHaveBeenCalledWith(
        wsId,
        mBuildTelegramChatKey(String(FIXED_CHAT_ID), String(FIXED_USER_ID))
      )
      expect(ctx.reply).toHaveBeenCalledWith('🔓 Chat desvinculado del workspace.', { parse_mode: 'HTML' })
    })
  })

  describe('handleMessage', () => {
    it('sin binding → reply instrucciones y getLLM NO llamado', async () => {
      mFindBinding.mockResolvedValue(null)
      const ctx = makeCtxStub()
      await handleMessage(ctx, 'crea un nodo')
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('no está vinculado'), { parse_mode: 'HTML' })
      expect(mGetLLM).not.toHaveBeenCalled()
    })

    it('isAIEnabled=false → reply IA deshabilitada y LLM no llamado', async () => {
      mFindBinding.mockResolvedValue({
        telegramChatId: String(FIXED_CHAT_ID),
        telegramUserId: String(FIXED_USER_ID),
        workspaceId: wsId,
        userId: ownerId,
        createdAt: new Date(),
      })
      mIsAIEnabled.mockReturnValue(false)
      const ctx = makeCtxStub()
      await handleMessage(ctx, 'crea un nodo')
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('IA está deshabilitada'), { parse_mode: 'HTML' })
      expect(mGetLLM).not.toHaveBeenCalled()
    })

    it('binding + shouldCreate → createNode con binding.workspaceId y binding.userId (frontera)', async () => {
      mFindBinding.mockResolvedValue({
        telegramChatId: String(FIXED_CHAT_ID),
        telegramUserId: String(FIXED_USER_ID),
        workspaceId: wsId,
        userId: ownerId,
        createdAt: new Date(),
      })
      mIsAIEnabled.mockReturnValue(true)
      mGetWorkspaceGraph.mockResolvedValue({ nodes: [], edges: [] })
      mGenerateText.mockResolvedValue({
        text: JSON.stringify({ shouldCreate: true, node: { type: 'task', title: 'x', status: 'todo' }, reply: null }),
      } as never)
      mCreateNode.mockResolvedValue({ id: 'node-1', type: 'task', title: 'x' } as never)

      const ctx = makeCtxStub()
      await handleMessage(ctx, 'crea una tarea x')

      expect(mGetLLM).toHaveBeenCalled()
      expect(mCreateNode).toHaveBeenCalledWith(wsId, ownerId, { type: 'task', title: 'x', status: 'todo' })
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('✅ Nodo creado: <b>x</b> (task · node-1)'),
        { parse_mode: 'HTML' }
      )
      // Memoria: persiste user + assistant del turno con source telegram
      expect(mAppendAndTrimChatMessages).toHaveBeenCalledWith({
        workspaceId: wsId,
        chatKey: mBuildTelegramChatKey(String(FIXED_CHAT_ID), String(FIXED_USER_ID)),
        source: 'telegram',
        messages: [
          { role: 'user', content: 'crea una tarea x' },
          { role: 'assistant', content: 'Nodo creado: x (task · node-1)' },
        ],
      })
    })

    it('shouldCreate=false + reply → solo reply, createNode NO llamado', async () => {
      mFindBinding.mockResolvedValue({
        telegramChatId: String(FIXED_CHAT_ID),
        telegramUserId: String(FIXED_USER_ID),
        workspaceId: wsId,
        userId: ownerId,
        createdAt: new Date(),
      })
      mIsAIEnabled.mockReturnValue(true)
      mGetWorkspaceGraph.mockResolvedValue({ nodes: [], edges: [] })
      mGenerateText.mockResolvedValue({
        text: JSON.stringify({ shouldCreate: false, node: null, reply: 'Hola' }),
      } as never)

      const ctx = makeCtxStub()
      await handleMessage(ctx, 'hola')

      expect(mCreateNode).not.toHaveBeenCalled()
      expect(ctx.reply).toHaveBeenCalledWith('Hola', { parse_mode: 'HTML' })
      // El reply-corto también se guarda en memoria
      expect(mAppendAndTrimChatMessages).toHaveBeenCalledWith({
        workspaceId: wsId,
        chatKey: expect.any(String),
        source: 'telegram',
        messages: [
          { role: 'user', content: 'hola' },
          { role: 'assistant', content: 'Hola' },
        ],
      })
    })

    it('LLM devuelve JSON no válido → reply amigable sin crash y sin persistir', async () => {
      mFindBinding.mockResolvedValue({
        telegramChatId: String(FIXED_CHAT_ID),
        telegramUserId: String(FIXED_USER_ID),
        workspaceId: wsId,
        userId: ownerId,
        createdAt: new Date(),
      })
      mIsAIEnabled.mockReturnValue(true)
      mGetWorkspaceGraph.mockResolvedValue({ nodes: [], edges: [] })
      mGenerateText.mockResolvedValue({ text: '{"shouldCreate":true, node: rotos' } as never)

      const ctx = makeCtxStub()
      await handleMessage(ctx, 'crea algo confuso')

      expect(ctx.reply).toHaveBeenCalledWith(
        'No pude interpretar tu mensaje. Intenta de nuevo con una instrucción más clara.',
        { parse_mode: 'HTML' }
      )
      expect(mCreateNode).not.toHaveBeenCalled()
      expect(mAppendAndTrimChatMessages).not.toHaveBeenCalled()
    })

    it('createNode lanza ValidationError (status en no-task) → reply amigable sin crash', async () => {
      mFindBinding.mockResolvedValue({
        telegramChatId: String(FIXED_CHAT_ID),
        telegramUserId: String(FIXED_USER_ID),
        workspaceId: wsId,
        userId: ownerId,
        createdAt: new Date(),
      })
      mIsAIEnabled.mockReturnValue(true)
      mGetWorkspaceGraph.mockResolvedValue({ nodes: [], edges: [] })
      mGenerateText.mockResolvedValue({
        text: JSON.stringify({ shouldCreate: true, node: { type: 'note', title: 'x', status: 'todo' }, reply: null }),
      } as never)
      mCreateNode.mockRejectedValue(new ValidationError('Solo los nodos de tipo task pueden tener estado'))

      const ctx = makeCtxStub()
      await handleMessage(ctx, 'crea una nota')

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('No pude crear el nodo: Solo los nodos de tipo task pueden tener estado'),
        { parse_mode: 'HTML' }
      )
    })

    it('createNode lanza ForbiddenError (usuario degradado) → reply "sin permisos"', async () => {
      mFindBinding.mockResolvedValue({
        telegramChatId: String(FIXED_CHAT_ID),
        telegramUserId: String(FIXED_USER_ID),
        workspaceId: wsId,
        userId: ownerId,
        createdAt: new Date(),
      })
      mIsAIEnabled.mockReturnValue(true)
      mGetWorkspaceGraph.mockResolvedValue({ nodes: [], edges: [] })
      mGenerateText.mockResolvedValue({
        text: JSON.stringify({ shouldCreate: true, node: { type: 'task', title: 'x' }, reply: null }),
      } as never)
      mCreateNode.mockRejectedValue(new ForbiddenError('Se requiere rol mínimo: writer'))

      const ctx = makeCtxStub()
      await handleMessage(ctx, 'crea una tarea')

      expect(ctx.reply).toHaveBeenCalledWith('Sin permisos para crear nodos en este workspace.', { parse_mode: 'HTML' })
    })
  })

  describe('escapeHtml', () => {
    it('escapa <script> y & en títulos (solo &, <, > — diseño F4.2 §5.3)', () => {
      expect(escapeHtml('<script>alert("x&y")</script>')).toBe('&lt;script&gt;alert("x&amp;y")&lt;/script&gt;')
    })
  })

  describe('smoke wiring grammY', () => {
    it('createTelegramBot + transformer fake + handleUpdate(/start) no lanza', async () => {
      const bot = createTelegramBot('dummy-token')
      bot.api.config.use((prev, method, payload) => {
        if (method === 'sendMessage') {
          return Promise.resolve({
            ok: true,
            result: {
              message_id: 1,
              date: 0,
              chat: { id: FIXED_CHAT_ID, type: 'private', first_name: 'T' },
              text: (payload as { text?: string }).text ?? '',
            },
          } as never)
        }
        return prev(method, payload)
      })

      await expect(bot.handleUpdate(makeUpdate({ text: '/start' }))).resolves.toBeUndefined()
    })

    it('replies estáticos (/start, /help, /link sin args, mensaje sin binding) no contienen tags HTML crudos', async () => {
      const bot = createTelegramBot('dummy-token')
      const sentTexts: string[] = []
      bot.api.config.use((prev, method, payload) => {
        if (method === 'sendMessage') {
          sentTexts.push((payload as { text?: string }).text ?? '')
          return Promise.resolve({
            ok: true,
            result: {
              message_id: 1,
              date: 0,
              chat: { id: FIXED_CHAT_ID, type: 'private', first_name: 'T' },
              text: (payload as { text?: string }).text ?? '',
            },
          } as never)
        }
        return prev(method, payload)
      })

      await bot.handleUpdate(makeUpdate({ text: '/start' }))
      await bot.handleUpdate(makeUpdate({ text: '/help' }))
      await bot.handleUpdate(makeUpdate({ text: '/link' }))
      await bot.handleUpdate(makeUpdate({ text: 'hola' }))

      expect(sentTexts.length).toBeGreaterThan(0)
      for (const text of sentTexts) {
        expect(text).not.toMatch(/<[a-z]/i)
      }
    })
  })
})