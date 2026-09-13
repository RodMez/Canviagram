import { assertWorkspaceAccess } from '@/lib/auth/workspace-access'
import { listWorkspacesForUser } from '@/lib/canvas/workspace-by-slug'
import { ForbiddenError, NotFoundError } from '@/lib/errors'

export type WorkspaceListItem = { id: string; name: string; slug: string }

// NL switch intent (no slash): usar/usa/cambia + query, or switch to.
// Group 1 is the query. Intercept rules: trimmed len >= 2, no newline.
export const SWITCH_RE =
  /^(?:usar|usa|cambia(?:r)?(?:\s+(?:a|al|de|el))?|switch\s+to)\s+(.+?)\s*$/i

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
  | { kind: 'single'; workspace: WorkspaceListItem }
  | { kind: 'multi'; matches: WorkspaceListItem[]; query: string }
  | { kind: 'none'; query: string; all: WorkspaceListItem[] }

// Extract switch query from free text. Null when not a switch intent.
export function extractSwitchQuery(text: string): string | null {
  const m = text.trim().match(SWITCH_RE)
  if (!m) return null
  const q = (m[1] ?? '').trim()
  if (q.length < 2 || q.includes('\n')) return null
  return q
}

// Resolve target workspace for a user from an NL query.
export async function resolveSwitchTarget(
  userId: string,
  query: string
): Promise<SwitchTarget> {
  const q = query.trim()
  if (!q) return { kind: 'empty' }
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
