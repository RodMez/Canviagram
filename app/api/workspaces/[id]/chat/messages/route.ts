export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { z, ZodError } from 'zod'
import { getSession } from '@/lib/auth/session'
import { assertWorkspaceAccess } from '@/lib/auth/workspace-access'
import { handleApiError } from '@/lib/api-helpers'
import { ValidationError } from '@/lib/errors'
import {
  buildWebChatKey,
  listChatMessages,
  appendAndTrimChatMessages,
  clearChatMessages,
} from '@/lib/chat/repository'
import { persistChatMessagesSchema } from '@/lib/validators/chat'

function toDto(m: { id: string; role: 'user' | 'assistant'; content: string; createdAt: Date }) {
  return { id: m.id, role: m.role, content: m.content, createdAt: m.createdAt.toISOString() }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    await assertWorkspaceAccess(id, session.userId, 'viewer')
    const chatKey = buildWebChatKey(session.userId)
    const messages = await listChatMessages({ workspaceId: id, chatKey })
    return NextResponse.json({ messages: messages.map(toDto) })
  } catch (error) {
    return handleApiError(error)
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  let parsed: z.infer<typeof persistChatMessagesSchema>
  try {
    parsed = persistChatMessagesSchema.parse(body)
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Mensajes inválidos', details: error.issues },
        { status: 400 }
      )
    }
    return handleApiError(error)
  }

  try {
    await assertWorkspaceAccess(id, session.userId, 'viewer')
    const chatKey = buildWebChatKey(session.userId)
    const saved = await appendAndTrimChatMessages({
      workspaceId: id,
      chatKey,
      source: 'web',
      messages: parsed.messages.map((m) => ({ role: m.role, content: m.content })),
    })
    return NextResponse.json({ messages: saved.map(toDto) }, { status: 201 })
  } catch (error) {
    return handleApiError(error)
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    await assertWorkspaceAccess(id, session.userId, 'viewer')
    const chatKey = buildWebChatKey(session.userId)
    await clearChatMessages(id, chatKey)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return handleApiError(error)
  }
}