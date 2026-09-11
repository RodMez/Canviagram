import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { ForbiddenError } from '@/lib/errors'

// ============================================================
// Acceso a nivel plataforma (F5.5)
//
// `users.role` (user/admin) es ortogonal a WORKSPACE_ROLES: solo
// protege la administración de la instancia (/admin/*). Mismo
// patrón de throw que assertCanAdmin (workspace-access.ts).
// ============================================================

export async function assertIsAdmin(userId: string): Promise<void> {
  const row = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .get()
  if (!row || row.role !== 'admin') {
    throw new ForbiddenError('Requiere rol de administrador')
  }
}

/**
 * Variante no-throw para el shell global: el header muestra el link de
 * Administración solo si el usuario es admin. Ante cualquier fallo (sin fila,
 * DB caída) devuelve false — la ruta /admin/* sigue protegida por
 * assertIsAdmin en su page.tsx.
 */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  try {
    const row = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .get()
    return row?.role === 'admin'
  } catch {
    return false
  }
}
