import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

let rawUrl = process.env.DATABASE_URL ?? 'canviagram.db'
// Soporta DATABASE_URL con prefijo file: (ej. file:/tmp/build.db o file:./canviagram.db)
let dbPath = rawUrl
if (dbPath.startsWith('file:')) {
  dbPath = dbPath.slice(5)
}
const qIdx = dbPath.indexOf('?')
if (qIdx !== -1) {
  dbPath = dbPath.slice(0, qIdx)
}

const sqlite = new Database(dbPath, { timeout: 5000 })

function safePragma(stmt: string) {
  try {
    sqlite.pragma(stmt)
  } catch (error) {
    // Durante `next build` múltiples workers pueden competir por el mismo fichero /tmp/build.db
    // y causar SQLITE_BUSY en PRAGMA journal_mode. No debe romper el build.
    const isBuild = process.env.NEXT_PHASE === 'phase-production-build'
    if (!isBuild) {
      console.warn(`[db] pragma failed: ${stmt}`, error)
    }
  }
}

// Espera hasta 5 segundos antes de devolver SQLITE_BUSY — primero para que los siguientes pragmas esperen.
safePragma('busy_timeout = 5000')

// CRÍTICO: sin esto las foreign keys y los CASCADE son ignorados.
safePragma('foreign_keys = ON')

// WAL: mejor rendimiento para lecturas concurrentes (SSE + escrituras de IA).
safePragma('journal_mode = WAL')

// Balance entre seguridad y rendimiento en WAL mode.
safePragma('synchronous = NORMAL')

// Caché de 64 MB — reduce I/O en workspaces con muchos nodos.
safePragma('cache_size = -65536')

export const db = drizzle(sqlite, { schema })

export type DB = typeof db