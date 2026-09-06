import { NextResponse } from 'next/server'
import { ValidationError, NotFoundError, ForbiddenError, ConflictError, GoneError } from '@/lib/errors'

export function handleApiError(error: unknown): NextResponse {
  if (error instanceof ValidationError) {
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
  console.error('API error:', error instanceof Error ? { name: error.name, message: error.message } : error)
  return NextResponse.json({ error: 'Error interno' }, { status: 500 })
}

export function parseQueryInt(value: string | null, fallback: number): number {
  if (value === null) return fallback
  const n = parseInt(value, 10)
  return Number.isNaN(n) ? fallback : n
}
