'use client'

import { cn } from '@/lib/utils'

type Props = {
  displayName: string | null | undefined
  avatarUrl?: string | null
  size?: 'xs' | 'sm'
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '—'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

// Avatar de responsable (iniciales si no hay foto). Compartido entre
// la tarjeta del tablero, la tabla y el nodo del canvas.
export function AssigneeAvatar({ displayName, avatarUrl, size = 'xs' }: Props) {
  const sz = size === 'xs' ? 'h-5 w-5 text-[9px]' : 'h-6 w-6 text-[10px]'
  if (!displayName) {
    return (
      <span
        title="Sin asignar"
        className={cn('inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground', sz)}
        aria-label="Sin asignar"
      >
        ·
      </span>
    )
  }
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- avatar remoto sencillo, sin next/image
      <img
        src={avatarUrl}
        alt={displayName}
        title={displayName}
        className={cn('shrink-0 rounded-full object-cover', sz)}
      />
    )
  }
  return (
    <span
      title={displayName}
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-accent/15 font-semibold text-accent', sz)}
    >
      {initials(displayName)}
    </span>
  )
}