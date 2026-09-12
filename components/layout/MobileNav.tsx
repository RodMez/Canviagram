'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarDays, FolderKanban } from 'lucide-react'
import { cn } from '@/lib/utils'

// Navegación principal móvil: bottom bar persistente con targets >=44px.
// En sm+ se oculta y la navegación vive en AppHeader.
export function MobileNav() {
  const pathname = usePathname()
  const isToday = pathname === '/today' || pathname?.startsWith('/today/') === true
  const isWorkspaces =
    pathname?.startsWith('/workspaces') === true ||
    pathname?.startsWith('/w/') === true ||
    pathname?.startsWith('/invite') === true

  const itemClass = (active: boolean) =>
    cn(
      'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 px-2 text-[11px] font-semibold transition-colors active:bg-muted',
      active ? 'text-primary' : 'text-muted-foreground'
    )

  return (
    <nav
      aria-label="Navegación principal móvil"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 backdrop-blur safe-bottom sm:hidden"
    >
      <div className="grid h-16 grid-cols-2">
        <Link href="/today" aria-current={isToday ? 'page' : undefined} className={itemClass(isToday)}>
          <CalendarDays className="h-5 w-5" aria-hidden />
          <span>Hoy</span>
        </Link>
        <Link
          href="/workspaces"
          aria-current={isWorkspaces ? 'page' : undefined}
          className={itemClass(isWorkspaces)}
        >
          <FolderKanban className="h-5 w-5" aria-hidden />
          <span>Workspaces</span>
        </Link>
      </div>
    </nav>
  )
}
