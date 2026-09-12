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

# Telegram: si el bot está configurado, el secret del webhook es OBLIGATORIO y
# debe cumplir el alfabeto que Telegram exige (1-256, [A-Za-z0-9_-]). Falla
# temprano con mensaje claro en vez de arrancar con un webhook inseguro.
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  if [ -z "$TELEGRAM_WEBHOOK_SECRET" ]; then
    echo "[entrypoint] ERROR: TELEGRAM_BOT_TOKEN existe pero TELEGRAM_WEBHOOK_SECRET no está configurado" >&2
    exit 1
  fi
  if [ ${#TELEGRAM_WEBHOOK_SECRET} -lt 32 ]; then
    echo "[entrypoint] ERROR: TELEGRAM_WEBHOOK_SECRET must be at least 32 characters (usar un secreto aleatorio ~48 chars)" >&2
    exit 1
  fi
  if ! printf '%s' "$TELEGRAM_WEBHOOK_SECRET" | grep -Eq '^[A-Za-z0-9_-]+$'; then
    echo "[entrypoint] ERROR: TELEGRAM_WEBHOOK_SECRET solo admite [A-Za-z0-9_-] (sin caracteres especiales)" >&2
    exit 1
  fi
  echo "[entrypoint] Telegram habilitado: webhook secret válido (${#TELEGRAM_WEBHOOK_SECRET} chars)"
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

if [ -z "$BREVO_API_KEY" ]; then
  echo "[entrypoint] WARN: BREVO_API_KEY not set — email deshabilitado" >&2
fi

if [ -z "$VAPID_PUBLIC_KEY" ] || [ -z "$VAPID_PRIVATE_KEY" ] || [ -z "$VAPID_SUBJECT" ]; then
  echo "[entrypoint] WARN: VAPID_* incompleto — push deshabilitado" >&2
fi

if [ -z "$REMINDER_SWEEP_SECRET" ]; then
  echo "[entrypoint] WARN: REMINDER_SWEEP_SECRET not set — sweeper devuelve 503" >&2
fi

if [ -z "$NEXT_PUBLIC_APP_URL" ]; then
  echo "[entrypoint] WARN: NEXT_PUBLIC_APP_URL not set — links usan localhost" >&2
fi

echo "[entrypoint] Running database migrations..."
node ./scripts/migrate.mjs

if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  if [ -n "$TELEGRAM_WEBHOOK_URL" ]; then
    echo "[entrypoint] Setting Telegram webhook: $TELEGRAM_WEBHOOK_URL"
    node ./scripts/set-telegram-webhook.mjs --url "$TELEGRAM_WEBHOOK_URL" || echo "[entrypoint] WARN: webhook no configurado (reintenta tras arrancar)" >&2
  fi

  echo "[entrypoint] Publishing Telegram commands..."
  node ./scripts/set-telegram-commands.mjs --set || echo "[entrypoint] WARN: comandos no publicados (reintenta tras arrancar)" >&2
fi

echo "[entrypoint] Starting application..."
exec "$@"
