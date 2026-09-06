#!/usr/bin/env node
// Script CLI para configurar el webhook de Telegram (diseño F4.2 N6).
//
// Uso:
//   node scripts/set-telegram-webhook.mjs --url https://tu-host/api/telegram/webhook
//   node scripts/set-telegram-webhook.mjs --delete
//   node scripts/set-telegram-webhook.mjs --info
//
// Lee TELEGRAM_BOT_TOKEN y TELEGRAM_WEBHOOK_SECRET de .env.local (o process.env).
// Usa HTTP directo a la Bot API (no grammY) para no depender del token en runtime.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadEnvLocal() {
  const envPath = path.resolve(__dirname, '..', '.env.local')
  if (!fs.existsSync(envPath)) return
  const content = fs.readFileSync(envPath, 'utf8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const k = trimmed.slice(0, eqIdx).trim()
    let v = trimmed.slice(eqIdx + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (!process.env[k]) process.env[k] = v
  }
}

loadEnvLocal()

const token = process.env.TELEGRAM_BOT_TOKEN
const secret = process.env.TELEGRAM_WEBHOOK_SECRET

if (!token) {
  console.error('[telegram] TELEGRAM_BOT_TOKEN no configurado (revisa .env.local)')
  process.exit(1)
}

const args = process.argv.slice(2)
const urlIdx = args.indexOf('--url')
const url = urlIdx !== -1 ? args[urlIdx + 1] : undefined
const doDelete = args.includes('--delete')
const doInfo = args.includes('--info')

if (!url && !doDelete && !doInfo) {
  console.error('Uso: node scripts/set-telegram-webhook.mjs --url <https://host/api/telegram/webhook> | --delete | --info')
  process.exit(1)
}

const api = `https://api.telegram.org/bot${token}`

async function call(method, payload) {
  const res = await fetch(`${api}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json()
  if (!res.ok || data.ok !== true) {
    throw new Error(`${method} falló: ${JSON.stringify(data)}`)
  }
  return data.result
}

try {
  if (doInfo) {
    const info = await call('getWebhookInfo', {})
    console.log('[telegram] WebhookInfo:', JSON.stringify(info, null, 2))
  }
  if (url) {
    if (!secret) {
      console.error('[telegram] TELEGRAM_WEBHOOK_SECRET no configurado — el webhook rechazará requests sin el header')
      process.exit(1)
    }
    await call('setWebhook', { url, secret_token: secret })
    console.log(`[telegram] Webhook configurado en ${url} (secret_token: sí)`)
  }
  if (doDelete) {
    await call('deleteWebhook', {})
    console.log('[telegram] Webhook eliminado')
  }
} catch (error) {
  console.error('[telegram] ERROR:', error.message)
  process.exit(1)
}