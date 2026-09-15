import { assertWorkspaceAccess } from '@/lib/auth/workspace-access'
import { listWorkspacesForUser } from '@/lib/canvas/workspace-by-slug'
import { ForbiddenError, NotFoundError } from '@/lib/errors'

export type WorkspaceListItem = { id: string; name: string; slug: string }

// ============================================================
// NL switch intent (no slash): cambiar de workspace por lenguaje natural.
// Ejemplos: "usa alfa", "cámbiame a alfa", "pásame al proyecto", 
// "cambia de workspace", "quiero trabajar en alfa", "switch to alfa".
// Group 1 es la query. Intercept rules: trimmed len >= 2, no newline.
// ============================================================
const SWITCH_CONNECTIVE = '(?:a|al|de|el|en|para)'
export const SWITCH_RE = new RegExp(
  `^(?:(?:usar|usa|cambia|cambiar|cámbiame|cambiame|pasa|pasar|pásame|pasame|muéveme|mueveme|mueve|switch\\s+to|ir|trabaja|trabajar|navega|navegar)(?:\\s+${SWITCH_CONNECTIVE})?|(?:quiero|necesito)\\s+(?:trabajar|pasar|ir|moverme)\\s+(?:a|en))\\s+(.+?)\\s*$`,
  'i'
)

// Palabras vacías cuando el intento de cambio no nombra un workspace:
// "cambia de workspace", "usa el chat", "pásame a otro" → pedimos elegir.
const SWITCH_FILLER_WORDS = new Set([
  'workspace',
  'ws',
  'chat',
  'canal',
  'canvas',
  'tablero',
  'vista',
  'otro',
  'otra',
  'uno',
  'de',
  'a',
  'el',
  'la',
  'los',
  'las',
  'al',
  'mi',
  'mis',
  'este',
  'esta',
  'tu',
])

function isSwitchFillerQuery(query: string): boolean {
  const q = normalizeWs(query)
  if (!q) return true
  const tokens = q.split(' ')
  // Hasta 3 tokens de filler → intento sin target real ("otro workspace", "mi ws").
  return tokens.length <= 3 && tokens.every((t) => SWITCH_FILLER_WORDS.has(t))
}

// ============================================================
// NL delete intent (no slash): "borra X", "elimina mi proyecto".
// NUNCA ejecuta el borrado: devuelve el objetivo para confirmar.
// ============================================================
export const DELETE_SWITCH_RE =
  /^(?:borra|borrar|elimina|eliminar|quita|quitar|suprime|suprimir)(?:\s+(?:el|la))?\s+(.+?)\s*$/i

// Strip combining diacritical marks (U+0300-U+036F) after NFD.
// Numeric range keeps this file ASCII-only and ES5-safe (no downlevelIteration).
function stripDiacritics(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    if (code < 768 || code > 879) out += s.charAt(i)
  }
  return out
}

// Normalized fuzzy search: lowercase, no accents, dashes to space.
export function normalizeWs(value: string): string {
  return stripDiacritics(value.trim().toLowerCase().normalize('NFD'))
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
}

// Substring match (both directions) over name or slug.
export function matchWorkspace(
  query: string,
  ws: WorkspaceListItem[]
): WorkspaceListItem[] {
  const q = normalizeWs(query)
  if (!q) return []
  return ws.filter((w) => {
    const name = normalizeWs(w.name)
    const slug = normalizeWs(w.slug)
    return (
      name.includes(q) || slug.includes(q) || q.includes(name) || q.includes(slug)
    )
  })
}

export type SwitchTarget =
  | { kind: 'empty' }
  // Intento válido pero sin target real ("cambia de workspace") → selector.
  | { kind: 'unspecified' }
  | { kind: 'single'; workspace: WorkspaceListItem }
  | { kind: 'multi'; matches: WorkspaceListItem[]; query: string }
  | { kind: 'none'; query: string; all: WorkspaceListItem[] }

function cleanQuery(raw: string): string {
  let q = raw.trim()
  // Recorta signos de puntuación al inicio/fin (¿?!) y espacios internos duplicados.
  q = q.replace(/^[^\p{L}\p{N}#]+|[^\p{L}\p{N}#]+$/gu, '')
  return q
}

// Extract switch query from free text. Null when not a switch intent.
export function extractSwitchQuery(text: string): string | null {
  const raw = text.trim()
  // Los comandos con / son del dispatcher (bot/web arriba): nunca se interceptan.
  if (!raw || raw.startsWith('/')) return null
  const clean = cleanQuery(raw)
  if (!clean) return null
  const m = clean.match(SWITCH_RE)
  if (!m) return null
  const q = cleanQuery(m[1] ?? '')
  if (q.length < 2 || q.includes('\n')) return null
  return q
}

// Extract delete query from free text. Null when not a delete intent.
export function extractDeleteQuery(text: string): string | null {
  const raw = text.trim()
  if (!raw || raw.startsWith('/')) return null
  const clean = cleanQuery(raw)
  if (!clean) return null
  const m = clean.match(DELETE_SWITCH_RE)
  if (!m) return null
  const q = cleanQuery(m[1] ?? '')
  if (q.length < 2 || q.includes('\n')) return null
  return q
}

// Resolve target workspace for a user from an NL query.
// Shared por switch (cambiar) y delete (borrar) — misma resolución fuzzy.
export async function resolveSwitchTarget(
  userId: string,
  query: string
): Promise<SwitchTarget> {
  const q = query.trim()
  if (!q) return { kind: 'empty' }
  if (isSwitchFillerQuery(q)) return { kind: 'unspecified' }
  const all = (await listWorkspacesForUser(userId)) as WorkspaceListItem[]
  if (all.length === 0) return { kind: 'empty' }
  const matches = matchWorkspace(q, all)
  if (matches.length === 1) {
    const ws = matches[0]!
    try {
      const { workspace } = await assertWorkspaceAccess(ws.id, userId, 'viewer')
      return {
        kind: 'single',
        workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
      }
    } catch (error) {
      if (error instanceof ForbiddenError || error instanceof NotFoundError) {
        return { kind: 'none', query: q, all }
      }
      throw error
    }
  }
  if (matches.length > 1) return { kind: 'multi', matches, query: q }
  return { kind: 'none', query: q, all }
}