export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { workspaces, workspaceMembers } from '@/lib/db/schema'
import { eq, and, ne } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { getSession } from '@/lib/auth/session'
import { createWorkspaceSchema } from '@/lib/validators/workspace'
import { handleApiError } from '@/lib/api-helpers'
import { ConflictError, ValidationError } from '@/lib/errors'

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    // Query 1: Workspaces donde el usuario es owner
    const owned = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        ownerId: workspaces.ownerId,
        createdAt: workspaces.createdAt,
      })
      .from(workspaces)
      .where(eq(workspaces.ownerId, session.userId))
      .all()

    // Query 2: Workspaces donde el usuario es member (excluye owned para evitar duplicados)
    const memberWorkspaces = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        ownerId: workspaces.ownerId,
        createdAt: workspaces.createdAt,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(
        and(
          eq(workspaceMembers.userId, session.userId),
          ne(workspaces.ownerId, session.userId)
        )
      )
      .all()

    // Merge: owner primero, members después. Sin duplicados, sin Map.
    const workspacesList = [
      ...owned.map(w => ({ ...w, role: 'owner' as const })),
      ...memberWorkspaces,
    ]

    return NextResponse.json({ workspaces: workspacesList })
  } catch (error) {
    return handleApiError(error)
  }
}

export async function POST(request: Request) {
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

  let parsed: ReturnType<typeof createWorkspaceSchema.parse>
  try {
    parsed = createWorkspaceSchema.parse(body)
  } catch (error) {
    if (error instanceof Error && 'issues' in error) {
      const zodError = error as { issues: unknown; message: string }
      return handleApiError(new ValidationError(zodError.message, zodError.issues))
    }
    return handleApiError(error)
  }

  const workspaceId = uuidv4()
  const memberId = uuidv4()
  const now = new Date()

  try {
    db.transaction((tx) => {
      tx.insert(workspaces)
        .values({
          id: workspaceId,
          ownerId: session.userId,
          name: parsed!.name,
          slug: parsed!.slug,
          createdAt: now,
          updatedAt: now,
        })
        .run()
      tx.insert(workspaceMembers)
        .values({
          id: memberId,
          workspaceId,
          userId: session.userId,
          role: 'owner',
          joinedAt: now,
          createdAt: now,
        })
        .run()
    })

    return NextResponse.json(
      { workspace: { id: workspaceId, name: parsed!.name, slug: parsed!.slug, createdAt: now } },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase()
      if (msg.includes('unique') || msg.includes('constraint') || msg.includes('slug')) {
        return handleApiError(new ConflictError('El slug ya está en uso'))
      }
    }
    return handleApiError(error)
  }
}
