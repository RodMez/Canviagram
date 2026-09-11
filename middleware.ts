import { NextResponse, type NextRequest } from 'next/server'

const EXCLUDED_EXACT = new Set(['/', '/login', '/register', '/api/ai/chat-demo'])
const EXCLUDED_PREFIX = ['/api/auth/', '/api/health', '/_next/', '/favicon.ico']

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  if (EXCLUDED_EXACT.has(pathname)) return NextResponse.next()
  if (EXCLUDED_PREFIX.some((p) => pathname.startsWith(p))) return NextResponse.next()
  if (pathname.startsWith('/verify-email')) return NextResponse.next()
  const isProtected =
    pathname.startsWith('/w/') ||
    pathname.startsWith('/workspaces') ||
    pathname.startsWith('/today') ||
    pathname.startsWith('/settings') ||
    pathname.startsWith('/api/workspaces/') ||
    pathname.startsWith('/api/ai/') ||
    pathname.startsWith('/api/today')
  if (!isProtected) return NextResponse.next()
  const isAuthenticated = request.cookies.has('__Host-session')
  if (!isAuthenticated) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname + request.nextUrl.search)
    return NextResponse.redirect(loginUrl)
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/w/:path*', '/workspaces/:path*', '/today/:path*', '/settings/:path*', '/api/workspaces/:path*', '/api/ai/:path*', '/api/today'],
}
