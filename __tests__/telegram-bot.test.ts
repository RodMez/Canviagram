import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/lib/db'
import { users, workspaces } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { ForbiddenError } from '@/lib/errors'

vi.mock('@/lib/telegram/chats', () => ({
  findBinding: vi.fn(),
  upsertBinding: vi.fn(),
  deleteBinding: vi.fn(),
  setActiveWorkspace: vi.fn(),
  resetActiveWorkspace: vi.fn(),
  touchLastActivity: vi.fn(),
}))
vi.mock('@/lib/ai/provider', () => ({
  isAIEnabled: vi.fn(),
  getLLM: vi.fn(),
}))
vi.mock('@/lib/canvas-service', () => ({
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
  isStepCount: vi.fn(() => vi.fn()),
}))
vi.mock('@/lib/ai/tools', () => ({
  buildTools: vi.fn(() => ({
    createNode: {},
    updateNode: {},
    deleteNode: {},
    createEdge: {},
    deleteEdge: {},
    queryGraph: {},
  })),
}))

import { parseCommand, handleLink, handleUnlink, handleMessage, handleList, handleUse, handleStatus, escapeHtml, createTelegramBot } from '@/lib/telegram/bot'
import { createLinkCode, _clear as clearLinkStore } from '@/lib/telegram/link-store'
import { findBinding, upsertBinding, deleteBinding, setActiveWorkspace, resetActiveWorkspace, touchLastActivity } from '@/lib/telegram/chats'
import { isAIEnabled, getLLM } from '@/lib/ai/provider'
import { getWorkspaceGraph } from '@/lib/canvas-service'
import { generateText } from 'ai'
import { buildTelegramChatKey, listChatMessages, appendAndTrimChatMessages, clearChatMessages } from '@/lib/chat/repository'
import { makeUpdate, makeCtxStub, FIXED_CHAT_ID, FIXED_USER_ID } from '@/__tests__/helpers/telegram'

const mFindBinding = vi.mocked(findBinding)
const mUpsertBinding = vi.mocked(upsertBinding)
const mDeleteBinding = vi.mocked(deleteBinding)
const mSetActiveWorkspace = vi.mocked(setActiveWorkspace)
const mResetActiveWorkspace = vi.mocked(resetActiveWorkspace)
const mIsAIEnabled = vi.mocked(isAIEnabled)
const mGetLLM = vi.mocked(getLLM)
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

    it('/lista, /usar slug y /estado son comandos reconocidos', () => {
      expect(parseCommand('/lista')).toEqual({ kind: 'command', name: 'lista', args: [] })
      expect(parseCommand('/usar mi-proyecto')).toEqual({ kind: 'command', name: 'usar', args: ['MI-PROYECTO'] })
      expect(parseCommand('/estado')).toEqual({ kind: 'command', name: 'estado', args: [] })
    })
  })

  describe('handleLink', () => {
    it('ok → upsertBinding con (chatId, tgUserId, claim) y reply de éxito HTML', async () => {
      const { code } = createLinkCode({ workspaceId: wsId, userId: ownerId })
      const ctx = makeCtxStub()

      await handleLink(ctx, code)

      expect(mUpsertBinding).toHaveBeenCalledWith(String(FIXED_CHAT_ID), String(FIXED_USER_ID), {
        userId: ownerId,
        workspaceId: wsId,
      })
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Workspace activo: «Bot WS»'),
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
        activeWorkspaceId: wsId,
        lastActivityAt: new Date(),
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
      expect(ctx.reply).toHaveBeenCalledWith('🔓 Chat desvinculado de tu cuenta.', { parse_mode: 'HTML' })
    })
  })

  describe('comandos de workspace (Fase 1: /lista, /usar, /estado)', () => {
    it('/lista muestra los workspaces de la cuenta y marca el activo', async () => {
      mFindBinding.mockResolvedValue({
        telegramChatId: String(FIXED_CHAT_ID),
        telegramUserId: String(FIXED_USER_ID),
        activeWorkspaceId: wsId,
        lastActivityAt: new Date(),
        userId: ownerId,
        createdAt: new Date(),
      })
      const ctx = makeCtxStub()
      await handleList(ctx)
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('✅ (activo)'),
        { parse_mode: 'HTML' }
      )
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringMatching(/Bot WS/),
        { parse_mode: 'HTML' }
      )
    })

    it('sin binding → /lista pide /link primero', async () => {
      mFindBinding.mockResolvedValue(null)
      const ctx = makeCtxStub()
      await handleList(ctx)
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('no está vinculado'),
        { parse_mode: 'HTML' }
      )
    })

    it('/usar <slug> válido → setActiveWorkspace y reply de confirmación', async () => {
      mFindBinding.mockResolvedValue({
        telegramChatId: String(FIXED_CHAT_ID),
        telegramUserId: String(FIXED_USER_ID),
        activeWorkspaceId: null,
        lastActivityAt: new Date(),
        userId: ownerId,
        createdAt: new Date(),
      })
      const ctx = makeCtxStub()
      await handleUse(ctx, `bot-ws-${wsId.slice(0, 8)}`)
      expect(mSetActiveWorkspace).toHaveBeenCalledWith(String(FIXED_CHAT_ID), String(FIXED_USER_ID), wsId)
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Workspace activo'),
        { parse_mode: 'HTML' }
      )
    })

    it('/usar slug inexistente → reply de error y NO cambia', async () => {
      mFindBinding.mockResolvedValue({
        telegramChatId: String(FIXED_CHAT_ID),
        telegramUserId: String(FIXED_USER_ID),
        activeWorkspaceId: null,
        lastActivityAt: new Date(),
        userId: ownerId,
        createdAt: new Date(),
      })
      const ctx = makeCtxStub()
      await handleUse(ctx, 'no-existe')
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('No encontré el workspace'),
        { parse_mode: 'HTML' }
      )
      expect(mSetActiveWorkspace).not.toHaveBeenCalled()
    })

    it('/estado resume cuenta, workspace activo y última actividad', async () => {
      mFindBinding.mockResolvedValue({
        telegramChatId: String(FIXED_CHAT_ID),
        telegramUserId: String(FIXED_USER_ID),
        activeWorkspaceId: wsId,
        lastActivityAt: new Date('2026-09-01T12:00:00.000Z'),
        userId: ownerId,
        createdAt: new Date(),
      })
      const ctx = makeCtxStub()
      await handleStatus(ctx)
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringMatching(/Estado de este chat/),
        { parse_mode: 'HTML' }
      )
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('<b>Bot Owner</b>'),
        { parse_mode: 'HTML' }
      )
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('«Bot WS»'),
        { parse_mode: 'HTML' }
      )
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
        activeWorkspaceId: wsId,
        lastActivityAt: new Date(),
        userId: ownerId,
        createdAt: new Date(),
      })
      mIsAIEnabled.mockReturnValue(false)
      const ctx = makeCtxStub()
      await handleMessage(ctx, 'crea un nodo')
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('IA está deshabilitada'), { parse_mode: 'HTML' })
      expect(mGetLLM).not.toHaveBeenCalled()
    })

    it('binding + texto del asistente → reply (escapado), tools de paridad y memoria persistida', async () => {
      mFindBinding.mockResolvedValue({
        telegramChatId: String(FIXED_CHAT_ID),
        telegramUserId: String(FIXED_USER_ID),
        activeWorkspaceId: wsId,
        lastActivityAt: new Date(),
        userId: ownerId,
        createdAt: new Date(),
      })
      mIsAIEnabled.mockReturnValue(true)
      mGetWorkspaceGraph.mockResolvedValue({ nodes: [], edges: [] })
      mGenerateText.mockResolvedValue({ text: 'He creado una tarea "Comprar" & más' } as never)

      const ctx = makeCtxStub()
      await handleMessage(ctx, 'crea una tarea')

      expect(mGetLLM).toHaveBeenCalled()
      // Paridad con el chat web: mismas tools + stopWhen limitando iteraciones
      expect(mGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          system: expect.stringContaining('crear, actualizar y'),
          tools: expect.objectContaining({
            createNode: expect.anything(),
            updateNode: expect.anything(),
            deleteNode: expect.anything(),
            createEdge: expect.anything(),
            deleteEdge: expect.anything(),
            queryGraph: expect.anything(),
          }),
          stopWhen: expect.any(Function),
        })
      )
      expect(ctx.reply).toHaveBeenCalledWith('He creado una tarea "Comprar" &amp; más', { parse_mode: 'HTML' })
      // Memoria: persiste user + assistant del turno con source telegram
      expect(mAppendAndTrimChatMessages).toHaveBeenCalledWith({
        workspaceId: wsId,
        chatKey: mBuildTelegramChatKey(String(FIXED_CHAT_ID), String(FIXED_USER_ID)),
        source: 'telegram',
        messages: [
          { role: 'user', content: 'crea una tarea' },
          { role: 'assistant', content: 'He creado una tarea "Comprar" & más' },
        ],
      })
    })

    it('texto LLM vacío → reply fallback y NO persiste', async () => {
      mFindBinding.mockResolvedValue({
        telegramChatId: String(FIXED_CHAT_ID),
        telegramUserId: String(FIXED_USER_ID),
        activeWorkspaceId: wsId,
        lastActivityAt: new Date(),
        userId: ownerId,
        createdAt: new Date(),
      })
      mIsAIEnabled.mockReturnValue(true)
      mGetWorkspaceGraph.mockResolvedValue({ nodes: [], edges: [] })
      mGenerateText.mockResolvedValue({ text: '   ' } as never)

      const ctx = makeCtxStub()
      await handleMessage(ctx, 'crea algo')

      expect(ctx.reply).toHaveBeenCalledWith('Listo. Revisa tu canvas para ver los cambios.', { parse_mode: 'HTML' })
      expect(mAppendAndTrimChatMessages).not.toHaveBeenCalled()
    })

    it('respuesta LLM con HTML se escapa antes de enviar (XSS)', async () => {
      mFindBinding.mockResolvedValue({
        telegramChatId: String(FIXED_CHAT_ID),
        telegramUserId: String(FIXED_USER_ID),
        activeWorkspaceId: wsId,
        lastActivityAt: new Date(),
        userId: ownerId,
        createdAt: new Date(),
      })
      mIsAIEnabled.mockReturnValue(true)
      mGetWorkspaceGraph.mockResolvedValue({ nodes: [], edges: [] })
      mGenerateText.mockResolvedValue({ text: '<script>alert(1)</script>' } as never)

      const ctx = makeCtxStub()
      await handleMessage(ctx, 'hola')

      expect(ctx.reply).toHaveBeenCalledWith('&lt;script&gt;alert(1)&lt;/script&gt;', { parse_mode: 'HTML' })
      expect(mAppendAndTrimChatMessages).toHaveBeenCalled()
    })

    it('graph fetch lanza ForbiddenError → reset activo + reply "ya no disponible" y NO llama al LLM', async () => {
      mFindBinding.mockResolvedValue({
        telegramChatId: String(FIXED_CHAT_ID),
        telegramUserId: String(FIXED_USER_ID),
        activeWorkspaceId: wsId,
        lastActivityAt: new Date(),
        userId: ownerId,
        createdAt: new Date(),
      })
      mIsAIEnabled.mockReturnValue(true)
      mGetWorkspaceGraph.mockRejectedValue(new ForbiddenError('Se requiere rol mínimo: writer'))

      const ctx = makeCtxStub()
      await handleMessage(ctx, 'crea una tarea')

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('ya no está disponible'),
        { parse_mode: 'HTML' }
      )
      expect(vi.mocked(mResetActiveWorkspace)).toHaveBeenCalledWith(String(FIXED_CHAT_ID), String(FIXED_USER_ID))
      expect(mGenerateText).not.toHaveBeenCalled()
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