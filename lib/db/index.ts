import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

const DATABASE_URL = process.env.DATABASE_URL ?? 'canviagram.db'

const sqlite = new Database(DATABASE_URL)

// CRÍTICO: sin esto las foreign keys y los CASCADE son ignorados.
sqlite.pragma('foreign_keys = ON')

// WAL: mejor rendimiento para lecturas concurrentes (SSE + escrituras de IA).
sqlite.pragma('journal_mode = WAL')

// Balance entre seguridad y rendimiento en WAL mode.
sqlite.pragma('synchronous = NORMAL')

// Caché de 64 MB — reduce I/O en workspaces con muchos nodos.
sqlite.pragma('cache_size = -65536')

// Espera hasta 5 segundos antes de devolver SQLITE_BUSY.
sqlite.pragma('busy_timeout = 5000')

export const db = drizzle(sqlite, { schema })

export type DB = typeof db