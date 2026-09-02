import { NextResponse, type NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Verificar presencia de cookie de sesión (no valida firma aquí, solo presencia)
  const hasHostSession = request.cookies.has('__Host-session')
  const hasLegacy = request.cookies.has('session')
  const isAuthenticated = hasHostSession || hasLegacy

  if (!isAuthenticated) {
    const isApi = pathname.startsWith('/api/')
    if (isApi) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }
    // Para rutas de página protegidas, redirigir a /login con next param
    const loginUrl = new URL('/login', request.url)
    // Evitar redirect loop si ya está en /login o /register
    if (pathname !== '/login' && pathname !== '/register') {
      loginUrl.searchParams.set('next', pathname)
    }
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/api/workspaces/:path*',
    '/api/ai/:path*',
    '/api/telegram/:path*',
    '/w/:path*',
    '/workspaces/:path*',
    '/settings/:path*',
  ],
}
