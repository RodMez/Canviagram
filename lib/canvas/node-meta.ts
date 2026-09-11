import type { LucideIcon } from 'lucide-react'
import { ListChecks, StickyNote, Lightbulb, User, Package } from 'lucide-react'
import type { Node as DBNode } from '@/lib/db/schema'

export type NodeMetaEntry = { icon: LucideIcon; accent: string; label: string }

export const NODE_META: Record<DBNode['type'], NodeMetaEntry> = {
  task:     { icon: ListChecks,   accent: 'border-amber-500/40 bg-amber-500/10', label: 'Tarea' },
  note:     { icon: StickyNote,   accent: 'border-emerald-500/40 bg-emerald-500/10', label: 'Nota' },
  idea:     { icon: Lightbulb,    accent: 'border-violet-500/40 bg-violet-500/10', label: 'Idea' },
  person:   { icon: User,         accent: 'border-rose-500/40 bg-rose-500/10',   label: 'Persona' },
  resource: { icon: Package,      accent: 'border-teal-500/40 bg-teal-500/10',   label: 'Recurso' },
}
