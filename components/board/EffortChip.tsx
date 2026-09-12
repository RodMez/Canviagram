'use client'

import { Timer } from 'lucide-react'
import { cn } from '@/lib/utils'

// Talla derivada del esfuerzo (0..100): S ≤ 20, M ≤ 50, L ≤ 75, XL > 75.
export function effortSize(effort: number | null | undefined): 'S' | 'M' | 'L' | 'XL' | null {
  if (effort == null || !Number.isFinite(effort)) return null
  if (effort <= 20) return 'S'
  if (effort <= 50) return 'M'
  if (effort <= 75) return 'L'
  return 'XL'
}

type Props = { effort: number | null | undefined; className?: string }

// Chip de esfuerzo compartido (tarjeta del tablero, tabla): "◷ 40 · M".
export function EffortChip({ effort, className }: Props) {
  const size = effortSize(effort)
  if (effort == null || size == null) return null
  return (
    <span
      title={`Esfuerzo: ${effort} (talla ${size})`}
      className={cn('inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground', className)}
    >
      <Timer className="h-3 w-3" />
      {effort}
      <span className="opacity-70">·{size}</span>
    </span>
  )
}