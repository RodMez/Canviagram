#!/bin/sh
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "[entrypoint] ERROR: DATABASE_URL is not set" >&2
  exit 1
fi

if [ -z "$SESSION_SECRET" ]; then
  echo "[entrypoint] ERROR: SESSION_SECRET is not set" >&2
  exit 1
fi

# Validar longitud mínima 32 caracteres (POSIX sh sin ${#var} en algunos shells, pero sh soporta)
if [ ${#SESSION_SECRET} -lt 32 ]; then
  echo "[entrypoint] ERROR: SESSION_SECRET must be at least 32 characters" >&2
  exit 1
fi

# Resolver path real quitando prefijo file: para mkdir
DB_PATH="$DATABASE_URL"
case "$DB_PATH" in
  file:*)
    DB_PATH=$(echo "$DB_PATH" | sed 's/^file://')
    ;;
esac
# Remover query string si existe
DB_PATH=$(echo "$DB_PATH" | cut -d'?' -f1)

DB_DIR=$(dirname "$DB_PATH")
mkdir -p "$DB_DIR"

echo "[entrypoint] Running database migrations..."
node ./scripts/migrate.mjs

echo "[entrypoint] Starting application..."
exec "$@"
