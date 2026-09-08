import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    globals: true,
    // Todos los tests comparten un único SQLite (canviagram.db, WAL). Los workers
    // paralelos de vitest causan SQLITE_BUSY en transacciones → ejecución en serie.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
