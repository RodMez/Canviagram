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

try {
  const db = drizzle(sqlite)
  await migrate(db, { migrationsFolder: './lib/db/migrations' })
  console.log('[migrate] OK')
} catch (error) {
  console.error('[migrate] FAILED', error)
  process.exit(1)
} finally {
  sqlite.close()
}
