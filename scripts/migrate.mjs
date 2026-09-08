import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

const rawUrl = process.env.DATABASE_URL || '/data/canviagram.db'
let dbPath = rawUrl

// Soporta formato file:/path o file:path y plain path
if (dbPath.startsWith('file:')) {
  dbPath = dbPath.slice(5)
}

// Remover query params si existen (ej. ?cache=shared)
const qIdx = dbPath.indexOf('?')
if (qIdx !== -1) {
  dbPath = dbPath.slice(0, qIdx)
}

console.log(`[migrate] DATABASE_URL=${rawUrl} resolved to ${dbPath}`)

const sqlite = new Database(dbPath, { timeout: 5000 })

// Workaround drizzle-orm#5782: el migrator envuelve cada migración en BEGIN…COMMIT
// y SQLite ignora `PRAGMA foreign_keys` dentro de una transacción (no-op). Si la
// conexión tiene foreign_keys=ON, un rebuild de tabla (patrón __new_* de drizzle-kit)
// destruiría las filas hijas vía ON DELETE CASCADE SIN error ni rollback.
// Forzamos OFF explícito antes de migrar y lo restauramos después.
sqlite.pragma('foreign_keys = OFF')

try {
  const db = drizzle(sqlite)
  await migrate(db, { migrationsFolder: './lib/db/migrations' })
  console.log('[migrate] OK')
} catch (error) {
  console.error('[migrate] FAILED', error)
  process.exit(1)
} finally {
  sqlite.pragma('foreign_keys = ON')
  sqlite.close()
}
