import { cookies } from 'next/headers'

export type Session = {
  userId: string
  token: string
}

/**
 * Stub de sesión para F1.
 * Lee cookie 'session' si existe. Si no, retorna null.
 * En F2 se reemplazará por verificación real contra tabla sessions + SESSION_SECRET.
 */
export async function getSession(): Promise<Session | null> {
  try {
    const cookieStore = cookies()
    const token = cookieStore.get('session')?.value
    if (!token) return null
    // Por ahora no verificamos hash ni expiración; solo existencia del cookie
    // Usamos el valor como userId stub para permitir wiring de canvas-service
    return { userId: token, token }
  } catch {
    return null
  }
}

/**
 * Helper para rutas: retorna 401 si no hay sesión
 */
export async function requireSession() {
  const session = await getSession()
  if (!session) {
    return null
  }
  return session
}
