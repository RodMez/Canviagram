import { NextResponse } from 'next/server'
import { ValidationError, NotFoundError, ForbiddenError, ConflictError, GoneError, UnprocessableError } from '@/lib/errors'

export function handleApiError(error: unknown): NextResponse {
  if (error instanceof ValidationError) {
    return NextResponse.json({ error: error.message, details: error.details }, { status: error.statusCode })
  }
  if (error instanceof UnprocessableError) {
    return NextResponse.json({ error: error.message, details: error.details }, { status: error.statusCode })
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  if (error instanceof ConflictError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  if (error instanceof GoneError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  if (isUniqueConstraintError(error)) {
    return NextResponse.json({ error: 'Conflicto: recurso duplicado' }, { status: 409 })
  }
  console.error('API error:', error instanceof Error ? { name: error.name, message: error.message } : error)
  return NextResponse.json({ error: 'Error interno' }, { status: 500 })
}

export function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  const message = error instanceof Error ? error.message : String(error)
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || message.includes('SQLITE_CONSTRAINT_UNIQUE')
}

export function mapUniqueToConflict(error: unknown, message = 'Conflicto: recurso duplicado'): never {
  if (isUniqueConstraintError(error)) {
    throw new ConflictError(message)
  }
  throw error as never
}

export function parseQueryInt(value: string | null, fallback: number): number {
  if (value === null) return fallback
  const n = parseInt(value, 10)
  return Number.isNaN(n) ? fallback : n
}
