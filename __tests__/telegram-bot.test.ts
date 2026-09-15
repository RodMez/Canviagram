import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/lib/db'
import { users, workspaces, workspaceMembers } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { ForbiddenError } from '@/lib/errors'

vi.mock('@/lib/telegram/chats', () => ({
  findBinding: vi.fn(),
  upsertBinding: vi.fn(),
  deleteBinding: vi.fn(),
  setActiveWorkspace: vi.fn(),
  resetActiveWorkspace: vi.fn(),
  resetActiveWorkspacesByWorkspace: vi.fn(),
  touchLastActivity: vi.fn(),
}))
vi.mock('@/lib/ai/provider', () => ({
  isAIEnabled: vi.fn(),
  getLLM: vi.fn(),
  callWithFallback: vi.fn(async (fn: (model: unknown) => unknown) => fn({})),
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

import {
  parseCommand,
  handleLink,
  handleUnlink,
  handleMessage,
  handleList,
  handleUse,
  handleUseFuzzy,
  handleWorkspaceCallback,
  handleStatus,
  handleCreateWorkspace,
  handleRenameWorkspace,
  handleDeleteWorkspace,
  handleDeleteConfirmCallback,
  handleDeleteCancelCallback,
  buildDeleteConfirmKeyboard,
  escapeHtml,
  createTelegramBot,
  buildWorkspaceKeyboard,
  normalizeWs,
  matchWorkspace,
  SWITCH_RE,
} from '@/lib/telegram/bot'
import { formatForTelegram } from '@/lib/telegram/format'
import { createLinkCode, _clear as clearLinkStore } from '@/lib/telegram/link-store'
import { findBinding, upsertBinding, deleteBinding, setActiveWorkspace, resetActiveWorkspace, resetActiveWorkspacesByWorkspace, touchLastActivity } from '@/lib/telegram/chats'
import { isAIEnabled, getLLM, callWithFallback } from '@/lib/ai/provider'
import { getWorkspaceGraph } from '@/lib/canvas-service'
import { generateText } from 'ai'
import { buildTelegramChatKey, listChatMessages, appendAndTrimChatMessages, clearChatMessages } from '@/lib/chat/repository'
import { makeUpdate, makeCtxStub, makeCallbackUpdate, makeCallbackCtxStub, FIXED_CHAT_ID, FIXED_USER_ID } from '@/__tests__/helpers/telegram'

const mFindBinding = vi.mocked(findBinding)
const mUpsertBinding = vi.mocked(upsertBinding)
const mDeleteBinding = vi.mocked(deleteBinding)
const mSetActiveWorkspace = vi.mocked(setActiveWorkspace)
const mResetActiveWorkspace = vi.mocked(resetActiveWorkspace)
const mResetActiveWorkspacesByWorkspace = vi.mocked(resetActiveWorkspacesByWorkspace)
const mIsAIEnabled = vi.mocked(isAIEnabled)
const mGetLLM = vi.mocked(getLLM)
const mCallWithFallback = vi.mocked(callWithFallback)
const mGetWorkspaceGraph = vi.mocked(getWorkspaceGraph)
const mGenerateText = vi.mocked(generateText)
const mBuildTelegramChatKey = vi.mocked(buildTelegramChatKey)
const mListChatMessages = vi.mocked(listChatMessages)
const mAppendAndTrimChatMessages = vi.mocked(appendAndTrimChatMessages)
const mClearChatMessages = vi.mocked(clearChatMessages)

const ownerId = uuidv4()
const wsId = uuidv4()
const wsAlfaId = uuidv4()
const wsBetaId = uuidv4()
const otherOwnerId = uuidv4()
const wsOtherId = uuidv4()
const wsDelId = uuidv4()
const wsSlug = `bot-ws-${wsId.slice(0, 8)}`
const wsAlfaSlug = `proyecto-alfa-${wsAlfaId.slice(0, 8)}`
const wsBetaSlug = `proyecto-beta-${wsBetaId.slice(0, 8)}`
const wsOtherSlug = `otro-owner-${wsOtherId.slice(0, 8)}`
const wsDelSlug = `borrar-me-${wsDelId.slice(0, 8)}`

function bindingRow(activeWorkspaceId: string | null) {
  return {
    telegramChatId: String(FIXED_CHAT_ID),
    telegramUserId: String(FIXED_USER_ID),
    activeWorkspaceId,
    lastActivityAt: new Date(),
    userId: ownerId,
    createdAt: new Date(),
  }
}

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
      slug: wsSlug,
    })
    await db.insert(workspaces).values({
      id: wsAlfaId,
      ownerId,
      name: 'Proyecto Alfa',
      slug: wsAlfaSlug,
    })
    await db.insert(workspaces).values({
      id: wsBetaId,
      ownerId,
      name: 'Proyecto Beta',
      slug: wsBetaSlug,
    })
    await db.insert(users).values({
      id: otherOwnerId,
      email: `bot-other-${otherOwnerId.slice(0, 8)}@example.com`,
      passwordHash: 'hash',
      displayName: 'Other Owner',
      emailVerified: true,
    })
    await db.insert(workspaces).values({
      id: wsOtherId,
      ownerId: otherOwnerId,
      name: 'Workspace Ajeno',
      slug: wsOtherSlug,
    })
    await db.insert(workspaces).values({
      id: wsDelId,
      ownerId,
      name: 'Borrar Me',
      slug: wsDelSlug,
    })
  })

  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.id, wsDelId))
    await db.delete(workspaces).where(eq(workspaces.id, wsOtherId))
    await db.delete(users).where(eq(users.id, otherOwnerId))
    await db.delete(workspaces).where(eq(workspaces.id, wsBetaId))
    await db.delete(workspaces).where(eq(workspaces.id, wsAlfaId))
    await db.delete(workspaces).where(eq(workspaces.id, wsId))
    await db.delete(users).where(eq(users.id, ownerId))
  })

  beforeEach(() => {
    vi.clearAllMocks()
    clearLinkStore()
  })

  describe('parseCommand', () => {
    it('/link XYZ2AB9C → comando link con args (raw, sin upper)', () => {
      expect(parseCommand('/link XYZ2AB9C')).toEqual({ kind: 'command', name: 'link', args: ['XYZ2AB9C'] })
    })

    it('/LINK   xyz2   → args en raw (trim, SIN upper: el upper vive en handleLink)', () => {
      expect(parseCommand('/LINK   xyz2  ')).toEqual({ kind: 'command', name: 'link', args: ['xyz2'] })
    })

    it('texto plano → comando nulo', () => {
      expect(parseCommand('hola mundo')).toEqual({ kind: 'plain' })
      expect(parseCommand(undefined)).toEqual({ kind: 'plain' })
    })

    it('/unknown → nulo (comando desconocido)', () => {
      expect(parseCommand('/unknown')).toEqual({ kind: 'plain' })
    })

    it('/lista, /usar slug y /estado son comandos reconocidos (args raw)', () => {
      expect(parseCommand('/lista')).toEqual({ kind: 'command', name: 'lista', args: [] })
      expect(parseCommand('/usar mi-proyecto')).toEqual({ kind: 'command', name: 'usar', args: ['mi-proyecto'] })
      expect(parseCommand('/estado')).toEqual({ kind: 'command', name: 'estado', args: [] })
    })

    it('/start@MiBot y /lista@MiBot en grupos → sufijo @ ignorado', () => {
      expect(parseCommand('/start@MiBot')).toEqual({ kind: 'command', name: 'start', args: [] })
      expect(parseCommand('/lista@MiBot')).toEqual({ kind: 'command', name: 'lista', args: [] })
    })

    it('/LINK@MiBot xyz2 → nombre antes de @, args en raw (sin upper)', () => {
      expect(parseCommand('/LINK@MiBot xyz2')).toEqual({ kind: 'command', name: 'link', args: ['xyz2'] })
      expect(parseCommand('/usar@MiBot mi-proyecto')).toEqual({ kind: 'command', name: 'usar', args: ['mi-proyecto'] })
    })

    it('/unknown@MiBot → nulo (desconocido aunque lleve sufijo)', () => {
      expect(parseCommand('/unknown@MiBot')).toEqual({ kind: 'plain' })
    })

    it('/usar multi-palabra conserva todas las palabras (fuzzy)', () => {
      expect(parseCommand('/usar mi proyecto')).toEqual({ kind: 'command', name: 'usar', args: ['mi', 'proyecto'] })
    })

    it('comandos de workspace: /crear /nuevo /renombrar /editar /borrar /eliminar', () => {
      expect(parseCommand('/crear Mi Proyecto')).toEqual({ kind: 'command', name: 'crear', args: ['Mi', 'Proyecto'] })
      expect(parseCommand('/nuevo Alpha')).toEqual({ kind: 'command', name: 'nuevo', args: ['Alpha'] })
      expect(parseCommand('/renombrar X')).toEqual({ kind: 'command', name: 'renombrar', args: ['X'] })
      expect(parseCommand('/editar Z')).toEqual({ kind: 'command', name: 'editar', args: ['Z'] })
      expect(parseCommand('/borrar')).toEqual({ kind: 'command', name: 'borrar', args: [] })
      expect(parseCommand('/eliminar')).toEqual({ kind: 'command', name: 'eliminar', args: [] })
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

    it('código en minúsculas → se normaliza a UPPER en handleLink (parseCommand ya no upperca)', async () => {
      const { code } = createLinkCode({ workspaceId: wsId, userId: ownerId })
      const ctx = makeCtxStub()

      await handleLink(ctx, code.toLowerCase())

      expect(mUpsertBinding).toHaveBeenCalledWith(String(FIXED_CHAT_ID), String(FIXED_USER_ID), {
        userId: ownerId,
        workspaceId: wsId,
      })
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
      mFindBinding.mockResolvedValue(bindingRow(wsId))
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
    it('/lista muestra los workspaces de la cuenta, marca el activo y adjunta botones', async () => {
      mFindBinding.mockResolvedValue(bindingRow(wsId))
      const ctx = makeCtxStub()
      await handleList(ctx)
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('✅ (activo)'),
        expect.objectContaining({ parse_mode: 'HTML' })
      )
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringMatching(/Bot WS/),
        expect.objectContaining({ parse_mode: 'HTML' })
      )
      const markup = (ctx.reply.mock.calls[0]?.[1] as { reply_markup?: { inline_keyboard: Array<Array<{ callback_data: string }>> } })?.reply_markup
      expect(markup?.inline_keyboard.length).toBeGreaterThan(0)
      expect(markup?.inline_keyboard.flat().some((b) => b.callback_data === `usar:${wsId}`)).toBe(true)
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

    it('/usar <slug> válido → setActiveWorkspace y reply de confirmación con <b> + <code>', async () => {
      mFindBinding.mockResolvedValue(bindingRow(null))
      const ctx = makeCtxStub()
      await handleUse(ctx, wsSlug)
      expect(mSetActiveWorkspace).toHaveBeenCalledWith(String(FIXED_CHAT_ID), String(FIXED_USER_ID), wsId)
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Workspace activo'),
        { parse_mode: 'HTML' }
      )
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('<b>Bot WS</b>'),
        { parse_mode: 'HTML' }
      )
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining(`<code>${wsSlug}</code>`),
        { parse_mode: 'HTML' }
      )
    })

    it('/usar slug inexistente → reply de error con botones y NO cambia', async () => {
      mFindBinding.mockResolvedValue(bindingRow(null))
      const ctx = makeCtxStub()
      await handleUse(ctx, 'no-existe-zzz')
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('No encontré el workspace'),
        expect.objectContaining({ parse_mode: 'HTML' })
      )
      expect(mSetActiveWorkspace).not.toHaveBeenCalled()
      const markup = (ctx.reply.mock.calls[0]?.[1] as { reply_markup?: unknown })?.reply_markup
      expect(markup).toBeDefined()
    })

    it('/usar sin args → botones (no "Uso..." seco)', async () => {
      mFindBinding.mockResolvedValue(bindingRow(wsId))
      const ctx = makeCtxStub()
      await handleUse(ctx, '')
      expect(mSetActiveWorkspace).not.toHaveBeenCalled()
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Elige el workspace activo'),
        expect.objectContaining({ parse_mode: 'HTML' })
      )
      const markup = (ctx.reply.mock.calls[0]?.[1] as { reply_markup?: { inline_keyboard: unknown[] } })?.reply_markup
      expect(markup?.inline_keyboard.length).toBeGreaterThan(0)
    })

    it('/estado resume cuenta, workspace activo (+ slug) y última actividad', async () => {
      mFindBinding.mockResolvedValue({
        ...bindingRow(wsId),
        lastActivityAt: new Date('2026-09-01T12:00:00.000Z'),
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
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining(`<code>${wsSlug}</code>`),
        { parse_mode: 'HTML' }
      )
    })
  })

  describe('helpers puros: keyboard, normalize, match (§5)', () => {
    it('buildWorkspaceKeyboard: un botón por workspace, callback_data usar:<uuid> 41B, activo con ✅', () => {
      const kb = buildWorkspaceKeyboard(
        [
          { id: wsId, name: 'Bot WS', slug: wsSlug },
          { id: wsAlfaId, name: 'Proyecto Alfa', slug: wsAlfaSlug },
        ],
        wsId
      )
      expect(kb.inline_keyboard).toHaveLength(2)
      const rows = kb.inline_keyboard as Array<Array<{ text: string; callback_data: string }>>
      const [first, second] = rows.flat()
      expect(first?.callback_data).toBe(`usar:${wsId}`)
      expect(first?.callback_data.length).toBe(41)
      expect(first?.text).toContain('✅')
      expect(second?.callback_data).toBe(`usar:${wsAlfaId}`)
      expect(second?.text).not.toContain('✅')
    })

    it('normalizeWs: minúsculas, sin tildes, guiones → espacio', () => {
      expect(normalizeWs('  Proyecto-Ágil_X  ')).toBe('proyecto agil x')
      expect(normalizeWs('BOT-WS')).toBe('bot ws')
    })

    it('matchWorkspace: subcadena insensible a caso/guiones/acentos', () => {
      const list = [
        { id: wsId, name: 'Bot WS', slug: wsSlug },
        { id: wsAlfaId, name: 'Proyecto Alfa', slug: wsAlfaSlug },
      ]
      expect(matchWorkspace('bot', list)).toHaveLength(1)
      expect(matchWorkspace('PROYECTO ALFA', list).map((w) => w.id)).toEqual([wsAlfaId])
      expect(matchWorkspace('proyecto-alfa', list).map((w) => w.id)).toEqual([wsAlfaId])
      expect(matchWorkspace('zzz', list)).toHaveLength(0)
      expect(matchWorkspace('', list)).toHaveLength(0)
    })

    it('SWITCH_RE: detecta "usar/cambia/switch to X" y captura la query', () => {
      expect('usar mi proyecto'.match(SWITCH_RE)?.[1]).toBe('mi proyecto')
      expect('cambia a Alfa'.match(SWITCH_RE)?.[1]).toBe('Alfa')
      expect('switch to beta'.match(SWITCH_RE)?.[1]).toBe('beta')
      expect('hola mundo'.match(SWITCH_RE)).toBeNull()
      expect('/usar alfa'.match(SWITCH_RE)).toBeNull()
    })
  })

  describe('handleUseFuzzy (§5)', () => {
    it('1 match aproximado → cambia sin LLM', async () => {
      mFindBinding.mockResolvedValue(bindingRow(wsId))
      const ctx = makeCtxStub()
      await handleUseFuzzy(ctx, 'alfa')
      expect(mSetActiveWorkspace).toHaveBeenCalledWith(String(FIXED_CHAT_ID), String(FIXED_USER_ID), wsAlfaId)
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('<b>Proyecto Alfa</b>'), { parse_mode: 'HTML' })
    })

    it('N matches → desambigua con botones y NO cambia', async () => {
      mFindBinding.mockResolvedValue(bindingRow(wsId))
      const ctx = makeCtxStub()
      await handleUseFuzzy(ctx, 'proyecto')
      expect(mSetActiveWorkspace).not.toHaveBeenCalled()
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Elige uno'),
        expect.objectContaining({ parse_mode: 'HTML' })
      )
      const markup = (ctx.reply.mock.calls[0]?.[1] as { reply_markup?: { inline_keyboard: unknown[] } })?.reply_markup
      expect(markup?.inline_keyboard).toHaveLength(2)
    })

    it('0 matches → error + botones con todos y NO cambia', async () => {
      mFindBinding.mockResolvedValue(bindingRow(wsId))
      const ctx = makeCtxStub()
      await handleUseFuzzy(ctx, 'zzz-no-existe')
      expect(mSetActiveWorkspace).not.toHaveBeenCalled()
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('No encontré'),
        expect.objectContaining({ parse_mode: 'HTML' })
      )
    })
  })

  describe('workspace CRUD vía comando (crear/renombrar/borrar)', () => {
    it('buildDeleteConfirmKeyboard: botón sí (wdel) y cancelar (wcnl)', () => {
      const kb = buildDeleteConfirmKeyboard(wsDelId)
      const rows = kb.inline_keyboard.flat() as Array<{ text: string; callback_data: string }>
      expect(rows.map((b) => b.callback_data)).toEqual([`wdel:${wsDelId}`, `wcnl:${wsDelId}`])
      expect(rows[0]?.text).toContain('Sí, borrar')
      expect(rows[1]?.text).toContain('Cancelar')
    })

    it('/crear crea el workspace (slug autogenerado), lo deja activo y confirma', async () => {
      mFindBinding.mockResolvedValue(bindingRow(wsId))
      const ctx = makeCtxStub()
      await handleCreateWorkspace(ctx, 'Mi Proyecto Nuevo')
      const setActiveCalls = mSetActiveWorkspace.mock.calls
      expect(setActiveCalls).toHaveLength(1)
      const [, , newWsId] = setActiveCalls[0]!
      expect(typeof newWsId).toBe('string')
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Workspace <b>Mi Proyecto Nuevo</b> creado'),
        { parse_mode: 'HTML' }
      )
      const created = await db.select().from(workspaces).where(eq(workspaces.id, newWsId)).get()
      expect(created?.slug).toBeTruthy()
      // Miembro owner creado junto con el workspace
      const member = await db
        .select().from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, newWsId))
        .get()
      expect(member?.role).toBe('owner')
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, newWsId))
      await db.delete(workspaces).where(eq(workspaces.id, newWsId))
    })

    it('/crear sin chat vinculado → pide /link y NO crea', async () => {
      mFindBinding.mockResolvedValue(null)
      const ctx = makeCtxStub()
      await handleCreateWorkspace(ctx, 'X')
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('/link CÓDIGO'), { parse_mode: 'HTML' })
      expect(mSetActiveWorkspace).not.toHaveBeenCalled()
    })

    it('/renombrar renombra el workspace activo y mantiene el slug', async () => {
      mFindBinding.mockResolvedValue(bindingRow(wsAlfaId))
      const ctx = makeCtxStub()
      await handleRenameWorkspace(ctx, 'Proyecto Alfa Renombrado')
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Workspace renombrado a <b>Proyecto Alfa Renombrado</b>'),
        { parse_mode: 'HTML' }
      )
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining(`<code>${wsAlfaSlug}</code>`),
        { parse_mode: 'HTML' }
      )
      const row = await db.select().from(workspaces).where(eq(workspaces.id, wsAlfaId)).get()
      expect(row?.name).toBe('Proyecto Alfa Renombrado')
      expect(row?.slug).toBe(wsAlfaSlug)
      await db.update(workspaces).set({ name: 'Proyecto Alfa' }).where(eq(workspaces.id, wsAlfaId))
    })

    it('/renombrar sin workspace activo → pide elegir', async () => {
      mFindBinding.mockResolvedValue(bindingRow(null))
      const ctx = makeCtxStub()
      await handleRenameWorkspace(ctx, 'X')
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('no tiene un workspace activo'), { parse_mode: 'HTML' })
    })

    it('/borrar con activo y owner → pide confirmación inline (sin borrar todavía)', async () => {
      mFindBinding.mockResolvedValue(bindingRow(wsDelId))
      const ctx = makeCtxStub()
      await handleDeleteWorkspace(ctx)
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('¿Borrar el workspace «Borrar Me»?'),
        expect.objectContaining({ parse_mode: 'HTML' })
      )
      const markup = (ctx.reply.mock.calls[0]?.[1] as { reply_markup?: { inline_keyboard: Array<Array<{ callback_data: string }>> } })?.reply_markup
      expect(markup?.inline_keyboard.flat().map((b) => b.callback_data)).toEqual([`wdel:${wsDelId}`, `wcnl:${wsDelId}`])
      const stillThere = await db.select().from(workspaces).where(eq(workspaces.id, wsDelId)).get()
      expect(stillThere).toBeDefined()
    })

    it('wcnl cancelar → answerCallback + reply y NO borra', async () => {
      const ctx = makeCallbackCtxStub({ callbackData: `wcnl:${wsDelId}` })
      await handleDeleteCancelCallback(ctx)
      expect(ctx.answerCallback).toHaveBeenCalledWith('Cancelado')
      expect(ctx.reply).toHaveBeenCalledWith('Listo, no se borró nada.', { parse_mode: 'HTML' })
      const stillThere = await db.select().from(workspaces).where(eq(workspaces.id, wsDelId)).get()
      expect(stillThere).toBeDefined()
    })

    it('wdel spoof (workspace ajeno) → answerCallback + rechazo y NO borra', async () => {
      mFindBinding.mockResolvedValue(bindingRow(wsId))
      const ctx = makeCallbackCtxStub({ callbackData: `wdel:${wsOtherId}` })
      await handleDeleteConfirmCallback(ctx)
      expect(ctx.answerCallback).toHaveBeenCalledWith('Solo el propietario puede borrar')
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Solo el propietario'), { parse_mode: 'HTML' })
      const stillThere = await db.select().from(workspaces).where(eq(workspaces.id, wsOtherId)).get()
      expect(stillThere).toBeDefined()
    })

    it('wdel malformado (no uuid) → answerCallback y NO borra', async () => {
      const ctx = makeCallbackCtxStub({ callbackData: 'wdel:not-a-uuid' })
      await handleDeleteConfirmCallback(ctx)
      expect(ctx.answerCallback).toHaveBeenCalled()
      expect(ctx.reply).not.toHaveBeenCalled()
    })

    it('wdel confirmación válida → borra (owner, slug correcto) y resetea activo del chat', async () => {
      mFindBinding.mockResolvedValue(bindingRow(wsDelId))
      const ctx = makeCallbackCtxStub({ callbackData: `wdel:${wsDelId}` })
      await handleDeleteConfirmCallback(ctx)
      expect(ctx.answerCallback).toHaveBeenCalledWith('✅ Workspace borrado')
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('borrado'), { parse_mode: 'HTML' })
      expect(mResetActiveWorkspacesByWorkspace).toHaveBeenCalledWith(wsDelId)
      const gone = await db.select().from(workspaces).where(eq(workspaces.id, wsDelId)).get()
      expect(gone).toBeUndefined()
    })
  })

  describe('handleWorkspaceCallback (§5)', () => {
    it('ok → setActive + answerCallback + reply con <b>name</b> + <code>slug</code>', async () => {
      mFindBinding.mockResolvedValue(bindingRow(wsId))
      const ctx = makeCallbackCtxStub({ callbackData: `usar:${wsAlfaId}` })
      await handleWorkspaceCallback(ctx)
      expect(mSetActiveWorkspace).toHaveBeenCalledWith(String(FIXED_CHAT_ID), String(FIXED_USER_ID), wsAlfaId)
      expect(ctx.answerCallback).toHaveBeenCalled()
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('<b>Proyecto Alfa</b>'),
        { parse_mode: 'HTML' }
      )
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining(`<code>${wsAlfaSlug}</code>`),
        { parse_mode: 'HTML' }
      )
    })

    it('spoof (uuid sin acceso) → answerCallback + reply sin acceso y NO cambia', async () => {
      mFindBinding.mockResolvedValue(bindingRow(wsId))
      const ctx = makeCallbackCtxStub({ callbackData: `usar:${uuidv4()}` })
      await handleWorkspaceCallback(ctx)
      expect(ctx.answerCallback).toHaveBeenCalled()
      expect(mSetActiveWorkspace).not.toHaveBeenCalled()
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('No tienes acceso'), { parse_mode: 'HTML' })
    })

    it('malformada (no uuid) → answerCallback y NO cambia ni responde', async () => {
      mFindBinding.mockResolvedValue(bindingRow(wsId))
      const ctx = makeCallbackCtxStub({ callbackData: 'usar:not-a-uuid' })
      await handleWorkspaceCallback(ctx)
      expect(ctx.answerCallback).toHaveBeenCalled()
      expect(mSetActiveWorkspace).not.toHaveBeenCalled()
      expect(ctx.reply).not.toHaveBeenCalled()
    })

    it('sin binding → answerCallback + pide /link y NO cambia', async () => {
      mFindBinding.mockResolvedValue(null)
      const ctx = makeCallbackCtxStub({ callbackData: `usar:${wsId}` })
      await handleWorkspaceCallback(ctx)
      expect(ctx.answerCallback).toHaveBeenCalled()
      expect(mSetActiveWorkspace).not.toHaveBeenCalled()
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('/link CÓDIGO'), { parse_mode: 'HTML' })
    })
  })

  describe('formatForTelegram (§5)', () => {
    it('bold **x** → <b>x</b>', () => {
      const out = formatForTelegram('**negrita**')
      expect(out).toContain('<b>negrita</b>')
      expect(out).not.toContain('**')
    })

    it('heading "# T" no deja "#" suelto', () => {
      const out = formatForTelegram('# Mi titulo')
      expect(out).not.toContain('#')
      expect(out).toContain('Mi titulo')
    })

    it('XSS <script> se neutraliza (whitelist: tag eliminado, sin HTML crudo)', () => {
      const out = formatForTelegram('<script>alert(1)</script>')
      expect(out).not.toContain('<script>')
      expect(out).toContain('alert(1)')
    })

    it('link javascript: se filtra (queda el texto)', () => {
      const out = formatForTelegram('[evil](javascript:alert(1))')
      expect(out).not.toContain('javascript:')
      expect(out).toContain('evil')
    })

    it('link https ok → <a href>', () => {
      const out = formatForTelegram('[doc](https://example.com)')
      expect(out).toContain('<a href="https://example.com">doc</a>')
    })

    it('trunca a 4096 tag-aware y cierra tags', () => {
      const long = formatForTelegram(`**${'b'.repeat(5000)}**`)
      expect(long.length).toBeLessThanOrEqual(4096)
      expect(long).toContain('<b>')
      expect(long).toContain('</b>')
    })
  })

  describe('handleMessage', () => {
    it('sin binding → reply instrucciones y LLM NO llamado', async () => {
      mFindBinding.mockResolvedValue(null)
      const ctx = makeCtxStub()
      await handleMessage(ctx, 'crea un nodo')
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('no está vinculado'), { parse_mode: 'HTML' })
      expect(mGetLLM).not.toHaveBeenCalled()
      expect(mCallWithFallback).not.toHaveBeenCalled()
    })

    it('isAIEnabled=false → reply IA deshabilitada y LLM no llamado', async () => {
      mFindBinding.mockResolvedValue(bindingRow(wsId))
      mIsAIEnabled.mockReturnValue(false)
      const ctx = makeCtxStub()
      await handleMessage(ctx, 'crea un nodo')
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('IA está deshabilitada'), { parse_mode: 'HTML' })
      expect(mGetLLM).not.toHaveBeenCalled()
      expect(mCallWithFallback).not.toHaveBeenCalled()
    })

    it('auto-switch "usar <nombre>" con 1 match → cambia sin LLM ni grafo', async () => {
      mFindBinding.mockResolvedValue(bindingRow(wsId))
      mIsAIEnabled.mockReturnValue(true)
      const ctx = makeCtxStub()
      await handleMessage(ctx, 'usar alfa')
      expect(mSetActiveWorkspace).toHaveBeenCalledWith(String(FIXED_CHAT_ID), String(FIXED_USER_ID), wsAlfaId)
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('<b>Proyecto Alfa</b>'), { parse_mode: 'HTML' })
      expect(mGetWorkspaceGraph).not.toHaveBeenCalled()
      expect(mCallWithFallback).not.toHaveBeenCalled()
    })

    it('auto-switch sin matches → fallthrough al LLM', async () => {
      mFindBinding.mockResolvedValue(bindingRow(wsId))
      mIsAIEnabled.mockReturnValue(true)
      mGetWorkspaceGraph.mockResolvedValue({ nodes: [], edges: [] })
      mGenerateText.mockResolvedValue({ text: 'ok' } as never)
      const ctx = makeCtxStub()
      await handleMessage(ctx, 'usar zzz-no-existe-qq')
      expect(mSetActiveWorkspace).not.toHaveBeenCalled()
      expect(mCallWithFallback).toHaveBeenCalled()
    })

    it('binding + texto del asistente → reply formateado, tools de paridad y memoria RAW persistida', async () => {
      mFindBinding.mockResolvedValue(bindingRow(wsId))
      mIsAIEnabled.mockReturnValue(true)
      mGetWorkspaceGraph.mockResolvedValue({ nodes: [], edges: [] })
      mGenerateText.mockResolvedValue({ text: 'He creado una tarea "Comprar" & más' } as never)

      const ctx = makeCtxStub()
      await handleMessage(ctx, 'crea una tarea')

      // F5.5: el modelo se resuelve vía callWithFallback (getLLM directo ya no se usa aquí).
      expect(mCallWithFallback).toHaveBeenCalled()
      expect(mGetLLM).not.toHaveBeenCalled()
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
      // Memoria: persiste user + assistant del turno con source telegram (RAW)
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
      mFindBinding.mockResolvedValue(bindingRow(wsId))
      mIsAIEnabled.mockReturnValue(true)
      mGetWorkspaceGraph.mockResolvedValue({ nodes: [], edges: [] })
      mGenerateText.mockResolvedValue({ text: '   ' } as never)

      const ctx = makeCtxStub()
      await handleMessage(ctx, 'crea algo')

      expect(ctx.reply).toHaveBeenCalledWith('Listo. Revisa tu canvas para ver los cambios.', { parse_mode: 'HTML' })
      expect(mAppendAndTrimChatMessages).not.toHaveBeenCalled()
    })

    it('respuesta LLM con HTML se neutraliza antes de enviar (XSS, whitelist)', async () => {
      mFindBinding.mockResolvedValue(bindingRow(wsId))
      mIsAIEnabled.mockReturnValue(true)
      mGetWorkspaceGraph.mockResolvedValue({ nodes: [], edges: [] })
      mGenerateText.mockResolvedValue({ text: '<script>alert(1)</script>' } as never)

      const ctx = makeCtxStub()
      await handleMessage(ctx, 'hola')

      // Whitelist: el tag <script> se elimina (no hay HTML crudo) y el interior
      // se conserva como texto. Memoria guarda el RAW.
      expect(ctx.reply).toHaveBeenCalledWith('alert(1)', { parse_mode: 'HTML' })
      expect(mAppendAndTrimChatMessages).toHaveBeenCalledWith({
        workspaceId: wsId,
        chatKey: mBuildTelegramChatKey(String(FIXED_CHAT_ID), String(FIXED_USER_ID)),
        source: 'telegram',
        messages: [
          { role: 'user', content: 'hola' },
          { role: 'assistant', content: '<script>alert(1)</script>' },
        ],
      })
    })

    it('graph fetch lanza ForbiddenError → reset activo + reply "ya no disponible" y NO llama al LLM', async () => {
      mFindBinding.mockResolvedValue(bindingRow(wsId))
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

    it('borrado por NL "borra <nombre>" de un workspace propio → confirmación inline SIN LLM', async () => {
      mFindBinding.mockResolvedValue(bindingRow(wsId))
      const ctx = makeCtxStub()
      await handleMessage(ctx, 'borra alfa')
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('¿Borrar el workspace «Proyecto Alfa»?'),
        expect.objectContaining({ parse_mode: 'HTML' })
      )
      const markup = (ctx.reply.mock.calls[0]?.[1] as { reply_markup?: { inline_keyboard: Array<Array<{ callback_data: string }>> } })?.reply_markup
      expect(markup?.inline_keyboard.flat().map((b) => b.callback_data)).toEqual([`wdel:${wsAlfaId}`, `wcnl:${wsAlfaId}`])
      expect(mCallWithFallback).not.toHaveBeenCalled()
      const stillThere = await db.select().from(workspaces).where(eq(workspaces.id, wsAlfaId)).get()
      expect(stillThere).toBeDefined()
    })

    it('borrado por NL con objetivo ambiguo → pregunta precisar SIN LLM', async () => {
      mFindBinding.mockResolvedValue(bindingRow(wsId))
      const ctx = makeCtxStub()
      await handleMessage(ctx, 'borra proyecto')
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Encontré 2 workspaces'),
        { parse_mode: 'HTML' }
      )
      expect(mCallWithFallback).not.toHaveBeenCalled()
    })

    it('borrado por NL sin match → error + /lista SIN LLM', async () => {
      mFindBinding.mockResolvedValue(bindingRow(wsId))
      const ctx = makeCtxStub()
      await handleMessage(ctx, 'borra zzz-no-existe')
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('No encontré el workspace'),
        { parse_mode: 'HTML' }
      )
      expect(mCallWithFallback).not.toHaveBeenCalled()
    })

    it('borrado por NL filler ("borra el workspace") → guía SIN LLM', async () => {
      mFindBinding.mockResolvedValue(bindingRow(wsId))
      const ctx = makeCtxStub()
      await handleMessage(ctx, 'borra el workspace')
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('¿Cuál workspace quieres borrar?'),
        { parse_mode: 'HTML' }
      )
      expect(mCallWithFallback).not.toHaveBeenCalled()
    })

    it('switch filler "cambia de workspace" → selector con botones SIN LLM', async () => {
      mFindBinding.mockResolvedValue(bindingRow(wsId))
      const ctx = makeCtxStub()
      await handleMessage(ctx, 'cambia de workspace')
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('¿A cuál workspace quieres cambiar?'),
        expect.objectContaining({ parse_mode: 'HTML' })
      )
      const markup = (ctx.reply.mock.calls[0]?.[1] as { reply_markup?: { inline_keyboard: unknown[] } })?.reply_markup
      expect(markup?.inline_keyboard).toHaveLength(3)
      expect(mSetActiveWorkspace).not.toHaveBeenCalled()
      expect(mCallWithFallback).not.toHaveBeenCalled()
    })

    it('typing indicator antes del LLM en el flujo normal', async () => {
      mFindBinding.mockResolvedValue(bindingRow(wsId))
      mIsAIEnabled.mockReturnValue(true)
      mGetWorkspaceGraph.mockResolvedValue({ nodes: [], edges: [] })
      mGenerateText.mockResolvedValue({ text: 'Listo' } as never)

      const ctx = makeCtxStub()
      await handleMessage(ctx, 'crea una tarea')

      expect(ctx.typing).toHaveBeenCalled()
      expect(mCallWithFallback).toHaveBeenCalled()
    })

    it('createWorkspace vía tool → deja el nuevo workspace activo y antepone confirmación', async () => {
      mFindBinding.mockResolvedValue(bindingRow(wsId))
      mIsAIEnabled.mockReturnValue(true)
      mGetWorkspaceGraph.mockResolvedValue({ nodes: [], edges: [] })
      mGenerateText.mockResolvedValue({
        text: 'Listo.',
        toolResults: [
          { toolName: 'createWorkspace', output: { workspace: { id: 'ws-nuevo-x', name: 'Nuevo X', slug: 'nuevo-x' } } },
        ],
      } as never)

      const ctx = makeCtxStub()
      await handleMessage(ctx, 'crea un workspace llamado Nuevo X')

      expect(mSetActiveWorkspace).toHaveBeenCalledWith(String(FIXED_CHAT_ID), String(FIXED_USER_ID), 'ws-nuevo-x')
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Workspace «Nuevo X» creado'),
        { parse_mode: 'HTML' }
      )
    })

    it('switchWorkspace vía tool → cambia el activo y confirma', async () => {
      mFindBinding.mockResolvedValue(bindingRow(wsId))
      mIsAIEnabled.mockReturnValue(true)
      mGetWorkspaceGraph.mockResolvedValue({ nodes: [], edges: [] })
      mGenerateText.mockResolvedValue({
        text: 'Listo.',
        toolResults: [
          { toolName: 'switchWorkspace', output: { workspace: { id: wsAlfaId, name: 'Proyecto Alfa', slug: wsAlfaSlug } } },
        ],
      } as never)

      const ctx = makeCtxStub()
      await handleMessage(ctx, 'cámbiame a un workspace al que no reconozco')

      expect(mSetActiveWorkspace).toHaveBeenCalledWith(String(FIXED_CHAT_ID), String(FIXED_USER_ID), wsAlfaId)
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Workspace activo: «Proyecto Alfa»'),
        { parse_mode: 'HTML' }
      )
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
      mFindBinding.mockResolvedValue(null)
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

    it('/link sin código sin binding → ayuda sola (menciona 1 vinculación)', async () => {
      mFindBinding.mockResolvedValue(null)
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

      await bot.handleUpdate(makeUpdate({ text: '/link', updateId: 101 }))
      expect(sentTexts.join('\n')).toContain('1 vinculación vale para todos')
    })

    it('/link sin código con binding → ayuda + botones', async () => {
      mFindBinding.mockResolvedValue(bindingRow(wsId))
      const bot = createTelegramBot('dummy-token')
      const payloads: Array<{ text?: string; reply_markup?: unknown }> = []
      bot.api.config.use((prev, method, payload) => {
        if (method === 'sendMessage') {
          payloads.push(payload as { text?: string; reply_markup?: unknown })
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

      await bot.handleUpdate(makeUpdate({ text: '/link', updateId: 102 }))
      expect(payloads).toHaveLength(1)
      expect(payloads[0]?.reply_markup).toBeDefined()
    })

    it('/usar sin args vía handleUpdate → botones (no "Uso..." seco)', async () => {
      mFindBinding.mockResolvedValue(bindingRow(wsId))
      const bot = createTelegramBot('dummy-token')
      const payloads: Array<{ text?: string; reply_markup?: unknown }> = []
      bot.api.config.use((prev, method, payload) => {
        if (method === 'sendMessage') {
          payloads.push(payload as { text?: string; reply_markup?: unknown })
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

      await bot.handleUpdate(makeUpdate({ text: '/usar', updateId: 103 }))
      expect(payloads).toHaveLength(1)
      expect(payloads[0]?.text).toContain('Elige el workspace activo')
      expect(payloads[0]?.reply_markup).toBeDefined()
    })

    it('callback "usar:<uuid>" vía handleUpdate → setActive + answerCallback + reply', async () => {
      mFindBinding.mockResolvedValue(bindingRow(wsId))
      const bot = createTelegramBot('dummy-token')
      const methods: string[] = []
      const sentTexts: string[] = []
      bot.api.config.use((prev, method, payload) => {
        methods.push(method)
        if (method === 'answerCallbackQuery') {
          return Promise.resolve({ ok: true, result: true } as never)
        }
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

      await bot.handleUpdate(makeCallbackUpdate({ data: `usar:${wsAlfaId}`, updateId: 104 }))
      expect(methods).toContain('answerCallbackQuery')
      expect(mSetActiveWorkspace).toHaveBeenCalledWith(String(FIXED_CHAT_ID), String(FIXED_USER_ID), wsAlfaId)
      expect(sentTexts.join('\n')).toContain('<b>Proyecto Alfa</b>')
    })
  })
})
