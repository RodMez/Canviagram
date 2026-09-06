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

if [ -z "$AI_API_KEY" ] && [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "[entrypoint] WARN: AI_API_KEY not set — IA deshabilitada (canvas funciona sin IA)" >&2
else
  echo "[entrypoint] AI provider: ${AI_BASE_URL:-https://openrouter.ai/api/v1} model=${AI_MODEL:-openrouter/free}"
fi

echo "[entrypoint] Running database migrations..."
node ./scripts/migrate.mjs

if [ -n "$TELEGRAM_WEBHOOK_URL" ]; then
  echo "[entrypoint] Setting Telegram webhook: $TELEGRAM_WEBHOOK_URL"
  node ./scripts/set-telegram-webhook.mjs --url "$TELEGRAM_WEBHOOK_URL" || echo "[entrypoint] WARN: webhook no configurado (reintenta tras arrancar)" >&2
fi

echo "[entrypoint] Starting application..."
exec "$@"
