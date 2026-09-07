import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'

export type UserProfile = {
  displayName: string
  email: string
  avatarUrl: string | null
}

/**
 * Perfil del usuario para el Toolbar (nombre/email reales para el avatar).
 * Se consulta en server component; el client recibe el displayName.
 */
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const row = await db
    .select({
      displayName: users.displayName,
      email: users.email,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get()

  if (!row) return null
  return { displayName: row.displayName, email: row.email, avatarUrl: row.avatarUrl ?? null }
}