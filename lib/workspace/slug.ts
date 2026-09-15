// server-only
import { db } from '@/lib/db'
import { workspaces } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

// Slugify cadenas para URLs: sin acentos, minúsculas, guiones.
// Canonical para workspace de registro y creación (antes vivía duplicado en
// app/api/auth/register/route.ts).
export function toSlug(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
}

/**
 * Genera un slug único válido (3-50 chars, lowercase, guiones) a partir de un
 * nombre. Deriva el base con toSlug, aplica fallbacks (workspace si vacío,
 * prefijo 'ws-' si < 3 chars) y verifica unicidad contra workspaces con
 * sufijo numérico -2, -3, … Si no encuentra hueco lanza Error (slug base -
 * 100 tomados).
 */
export async function generateUniqueSlug(name: string): Promise<string> {
  let baseSlug = toSlug(name)
  if (!baseSlug) baseSlug = 'workspace'
  if (baseSlug.length < 3) baseSlug = `ws-${baseSlug}`
  // Deja espacio para el sufijo -100 (máx 4 chars) y el límite 50.
  if (baseSlug.length > 45) baseSlug = baseSlug.slice(0, 45).replace(/-+$/g, '')

  let finalSlug = baseSlug
  let clash = await db.select().from(workspaces).where(eq(workspaces.slug, finalSlug)).get()
  let counter = 2
  while (clash && counter <= 100) {
    const suffix = `-${counter}`
    const maxBaseLen = 50 - suffix.length
    finalSlug = `${baseSlug.slice(0, maxBaseLen).replace(/-+$/g, '')}${suffix}`
    clash = await db.select().from(workspaces).where(eq(workspaces.slug, finalSlug)).get()
    counter++
  }
  if (clash) throw new Error('No se pudo generar un slug único para el workspace')
  return finalSlug
}