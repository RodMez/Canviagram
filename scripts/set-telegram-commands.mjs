#!/usr/bin/env node
// Script CLI para publicar los comandos Telegram visibles (menu del cliente).
//
// Uso:
//   node scripts/set-telegram-commands.mjs --set    # publica COMMANDS via setMyCommands
//   node scripts/set-telegram-commands.mjs --get    # lee getMyCommands e imprime
//   node scripts/set-telegram-commands.mjs --clear  # borra comandos (setMyCommands con [])
//   node scripts/set-telegram-commands.mjs --info   # ayuda local (no llama a la API)
//   node scripts/set-telegram-commands.mjs --help   # ayuda local (no llama a la API)
//
// Lee TELEGRAM_BOT_TOKEN de .env.local (o process.env).
// Usa HTTP directo a la Bot API (no grammY), igual que scripts/set-telegram-webhook.mjs.
//
// Nota scope/language: se envía solo { commands } para usar el scope default
// en todos los idiomas. No se fija language_code:"es" porque dejaría sin
// comandos a clientes en otro idioma; tampoco se envía scope explícito porque
// equivale al default y se evita romper si la API valida el shape.

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

// 7 comandos de gestión publicados. /ayuda queda como alias oculto (no publicado)
// pero sigue funcionando en el bot.
const COMMANDS = [
  { command: 'start', description: 'Iniciar el bot y ver bienvenida' },
  { command: 'help', description: 'Ver ayuda y comandos' },
  { command: 'link', description: 'Vincular chat: /link CODIGO' },
  { command: 'lista', description: 'Listar tus workspaces' },
  { command: 'usar', description: 'Cambiar workspace: /usar SLUG' },
  { command: 'estado', description: 'Ver cuenta y workspace activo' },
  { command: 'unlink', description: 'Desvincular este chat' },
]

function validateCommands(commands) {
  const nameRe = /^[a-z0-9_]{1,32}$/
  for (const c of commands) {
    if (!nameRe.test(c.command)) {
      throw new Error(`command inválido "${c.command}": debe ser 1-32 chars [a-z0-9_]`)
    }
    if (typeof c.description !== 'string' || c.description.length < 1 || c.description.length > 256) {
      throw new Error(`description inválida para "${c.command}": debe ser 1-256 chars`)
    }
  }
}

function printHelp() {
  console.log(`Uso: node scripts/set-telegram-commands.mjs --set | --get | --clear | --info | --help
  --set    Publica los 7 comandos de gestión via setMyCommands
  --get    Lee los comandos actuales via getMyCommands y los imprime
  --clear  Borra los comandos publicados (setMyCommands con [])
  --info   Muestra esta ayuda y la lista a publicar (no llama a la API)
  --help   Alias de --info

Comandos a publicar:
${COMMANDS.map((c) => `  /${c.command} — ${c.description}`).join('\n')}
`)
}

const args = process.argv.slice(2)
const doSet = args.includes('--set')
const doGet = args.includes('--get')
const doClear = args.includes('--clear')
const doInfo = args.includes('--info')
const doHelp = args.includes('--help') || args.includes('-h')

if (!doSet && !doGet && !doClear && !doInfo && !doHelp) {
  console.error('Uso: node scripts/set-telegram-commands.mjs --set | --get | --clear | --info | --help')
  process.exit(1)
}

// Ayuda local: no requiere token ni llama a la API (así funciona en CI sin token).
if ((doInfo || doHelp) && !doSet && !doGet && !doClear) {
  printHelp()
  process.exit(0)
}

const token = process.env.TELEGRAM_BOT_TOKEN

if ((doSet || doGet || doClear) && !token) {
  console.error('[telegram] TELEGRAM_BOT_TOKEN no configurado (revisa .env.local)')
  process.exit(1)
}

try {
  validateCommands(COMMANDS)
} catch (error) {
  console.error('[telegram] ERROR:', error.message)
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
  if (doInfo || doHelp) printHelp()
  if (doSet) {
    await call('setMyCommands', { commands: COMMANDS })
    console.log('[telegram] Comandos publicados (7):', COMMANDS.map((c) => `/${c.command}`).join(', '))
  }
  if (doGet) {
    const current = await call('getMyCommands', {})
    console.log('[telegram] Comandos actuales:', JSON.stringify(current, null, 2))
  }
  if (doClear) {
    await call('setMyCommands', { commands: [] })
    console.log('[telegram] Comandos eliminados')
  }
} catch (error) {
  console.error('[telegram] ERROR:', error.message)
  process.exit(1)
}
