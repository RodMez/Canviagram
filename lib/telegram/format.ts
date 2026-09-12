// Formato de respuestas LLM para Telegram (parse_mode HTML).
//
// El LLM responde en Markdown simple (ver system prompt en bot.ts) y aquí se
// convierte a HTML compatible con Telegram Bot API:
//   https://core.telegram.org/bots/api#html-style
//
// NOTA DE DISEÑO (desvío explícito de @architect, ver resultado final):
// `telegramify-markdown` evaluada y descartada por output MarkdownV2:
// convierte Markdown → MarkdownV2 (ej: "**hola**" → "*hola*",
// "hola." → "hola\\."), NO a HTML. Usarla como paso intermedio para HTML
// contaminaría la salida con backslashes de MarkdownV2 y no filtraría <a>.
// Por eso formatForTelegram implementa conversión propia markdown→HTML +
// whitelist + filtro de links + trunc tag-aware. Dependencia desinstalada,
// no se invoca en runtime.

export const TELEGRAM_MAX_LENGTH = 4096

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Tags permitidos por Telegram en parse_mode HTML (subset mínimo usado aquí).
const ALLOWED_TAGS = new Set([
  'b',
  'strong',
  'i',
  'em',
  'u',
  'ins',
  's',
  'strike',
  'del',
  'code',
  'pre',
  'a',
  'blockquote',
  'tg-spoiler',
])

const CLOSE_NEEDED = new Set([
  'b',
  'strong',
  'i',
  'em',
  'u',
  'ins',
  's',
  'strike',
  'del',
  'a',
  'code',
  'pre',
  'blockquote',
  'tg-spoiler',
  'span',
])

function isHttpUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://')
}

// Sanitiza HTML: escapa texto, conserva solo tags permitidos, filtra <a> a
// http/https (javascript:, data:, etc → se deja solo el texto interior).
function sanitizeTelegramHtml(html: string): string {
  const tokenRe = /(<\/?[a-zA-Z][^>]*>)/g
  const parts = html.split(tokenRe)
  let out = ''

  for (const part of parts) {
    if (!part) continue
    if (!part.startsWith('<') || !part.endsWith('>')) {
      out += escapeHtml(part)
      continue
    }

    const tagMatch = part.match(/^<\/?([a-zA-Z][a-zA-Z0-9-]*)/)
    if (!tagMatch) {
      out += escapeHtml(part)
      continue
    }
    const tagName = tagMatch[1]!.toLowerCase()
    const isClosing = part.startsWith('</')

    if (!ALLOWED_TAGS.has(tagName)) {
      // Tag no permitido (script, div, span genérico, etc): se elimina el tag
      // pero se conserva el interior (que llega como tokens de texto aparte).
      continue
    }

    if (isClosing) {
      out += `</${tagName}>`
      continue
    }

    if (tagName === 'a') {
      const hrefMatch = part.match(/href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i)
      const href = hrefMatch?.[2] ?? hrefMatch?.[3] ?? hrefMatch?.[4] ?? ''
      if (!isHttpUrl(href)) {
        // Link no http/https (javascript:, data:, relativo...): sin tag, el
        // texto interior se conserva como texto aparte.
        continue
      }
      out += `<a href="${escapeAttr(href)}">`
      continue
    }

    // Resto de tags permitidos sin atributos (class, etc. se eliminan).
    out += `<${tagName}>`
  }

  return out
}

// Trunca HTML a maxLength sin romper tags ni entidades, cerrando los tags
// abiertos y añadiendo "…". Si algo falla, el llamador aplica fallback.
export function truncateTelegramHtml(html: string, maxLength: number = TELEGRAM_MAX_LENGTH): string {
  if (html.length <= maxLength) return html

  const tokenRe = /(<\/?[a-zA-Z][^>]*>|&[a-zA-Z0-9#]+;)/g
  const tokens = html.split(tokenRe).filter((t) => t !== '')
  const ELLIPSIS = '…'
  const budget = maxLength - ELLIPSIS.length

  let out = ''
  let len = 0
  const openStack: string[] = []
  let truncated = false

  for (const token of tokens) {
    if (truncated) break

    if (token.startsWith('&') && token.endsWith(';')) {
      // Entidad completa: indivisible.
      if (len + token.length > budget) {
        truncated = true
        break
      }
      out += token
      len += token.length
      continue
    }

    if (token.startsWith('<') && token.endsWith('>')) {
      const tagMatch = token.match(/^<\/?([a-zA-Z][a-zA-Z0-9-]*)/)
      const tagName = tagMatch?.[1]?.toLowerCase() ?? ''
      const isClosing = token.startsWith('</')
      if (len + token.length > budget && len === 0 && openStack.length === 0) {
        truncated = true
        break
      }
      out += token
      len += token.length
      if (tagName && CLOSE_NEEDED.has(tagName)) {
        if (isClosing) {
          const idx = openStack.lastIndexOf(tagName)
          if (idx !== -1) openStack.splice(idx, 1)
        } else {
          openStack.push(tagName)
        }
      }
      continue
    }

    // Texto plano (ya escapado, sin "<" ni ">" crudos). Se reserva espacio
    // para cerrar los tags ya abiertos, de modo que el resultado siempre
    // cierra tags sin superar maxLength.
    const pendingCloseLen = openStack.reduce((acc, t) => acc + t.length + 3, 0)
    const remaining = budget - len - pendingCloseLen
    if (remaining <= 0) {
      truncated = true
      break
    }
    if (token.length <= remaining) {
      out += token
      len += token.length
    } else {
      // Cortar sin partir una entidad a medias: retrocede hasta fuera de "&...".
      let cut = remaining
      const head = token.slice(0, cut)
      const ampIdx = head.lastIndexOf('&')
      if (ampIdx !== -1 && !head.slice(ampIdx).includes(';')) {
        cut = ampIdx
      }
      out += token.slice(0, cut)
      len += cut
      truncated = true
      break
    }
  }

  if (!truncated) return out

  out += ELLIPSIS
  len += ELLIPSIS.length

  // Cerrar tags abiertos en orden inverso (sin superar el límite).
  for (let i = openStack.length - 1; i >= 0; i--) {
    const close = `</${openStack[i]}>`
    if (len + close.length > maxLength) break
    out += close
    len += close.length
  }

  return out
}

// Tokens visibles solo-letras+dígitos (sin *, _, #, <, >, &, ~, |, `, [, ], (, ))
// para que los pasos de markdown no los toquen. Colisión con texto real:
// negligible (cadenas largas arbitrarias).
const PRE_TOKEN = 'ZZTGPPRE9QZZ'
const CODE_TOKEN = 'ZZTGPCODE9QZZ'
const CB_TOKEN = 'ZZTGPCB9QZZ'

// Restaura tokens en orden (reemplazo literal uno a uno, sin regex).
function restoreInOrder(text: string, token: string, count: number, make: (index: number) => string): string {
  let out = text
  for (let i = 0; i < count; i++) {
    const pos = out.indexOf(token)
    if (pos === -1) break
    out = out.slice(0, pos) + make(i) + out.slice(pos + token.length)
  }
  return out
}

// Convierte Markdown simple del LLM a HTML Telegram + sanitiza + trunca.
// - **bold**/__bold__ → <b>, *it*/_it_ → <i>, ~~t~~ → <s>, ||t|| → <tg-spoiler>
// - `code` → <code>, ```block``` → <pre>, [t](https://...) → <a>
// - "# tit" → <b>tit</b>, "> cita" → <blockquote>, listas → "• ", "---" → ""
// - Raw HTML no permitido se filtra (XSS); <a> solo http/https.
// - Fallback: escapeHtml (nunca lanza).
export function formatForTelegram(raw: string): string {
  try {
    if (!raw) return ''

    const preBlocks: string[] = []
    const codeSpans: string[] = []

    // 1. Proteger bloques de código (no se procesa markdown dentro).
    let working = raw.replace(/```(?:\w+)?\n([\s\S]*?)```/g, (_m, code: string) => {
      preBlocks.push(code.replace(/\n$/, ''))
      return PRE_TOKEN
    })
    working = working.replace(/`([^`\n]+)`/g, (_m, code: string) => {
      codeSpans.push(code)
      return CODE_TOKEN
    })

    // 2. Links markdown [texto](url): solo http/https → <a>, resto → texto.
    working = working.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) => {
      const cleanUrl = url.trim()
      if (!isHttpUrl(cleanUrl)) return text
      return `<a href="${cleanUrl}">${text}</a>`
    })

    // 3. Formato inline (sobre texto sin código).
    working = working
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/__([^_]+)__/g, '<b>$1</b>')
      .replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<i>$2</i>')
      .replace(/(^|[^\w])_([^_\n]+)_/g, '$1<i>$2</i>')
      .replace(/~~([^~]+)~~/g, '<s>$1</s>')
      .replace(/\|\|([^|]+)\|\|/g, '<tg-spoiler>$1</tg-spoiler>')

    // 4. Bloques por línea: headings, quotes, listas, reglas.
    const lines = working.split('\n').map((line) => {
      const heading = line.match(/^#{1,6}\s+(.+)$/)
      if (heading) return `<b>${heading[1]}</b>`
      const quote = line.match(/^>\s?(.*)$/)
      if (quote) return `<blockquote>${quote[1]}</blockquote>`
      if (/^(\*\*\*|---|___)\s*$/.test(line.trim())) return ''
      const ul = line.match(/^(\s*)[-*]\s+(.+)$/)
      if (ul) return `${ul[1]}• ${ul[2]}`
      const ol = line.match(/^(\s*)\d+\.\s+(.+)$/)
      if (ol) return `${ol[1]}• ${ol[2]}`
      return line
    })
    working = lines.join('\n')

    // 5. Restaurar código como <code>/<pre> (el contenido se escapa en el paso 6).
    working = restoreInOrder(working, PRE_TOKEN, preBlocks.length, (i) => `<pre>${preBlocks[i]}</pre>`)
    working = restoreInOrder(working, CODE_TOKEN, codeSpans.length, (i) => `<code>${codeSpans[i]}</code>`)

    // 6. Sanitizar preservando <code>/<pre> como texto literal: se extraen
    // antes para que los "<" del código no se confundan con tags.
    const cbTags: string[] = []
    const cbInners: string[] = []
    working = working.replace(/<(pre|code)>([\s\S]*?)<\/\1>/g, (_m, tag: string, inner: string) => {
      cbTags.push(tag)
      cbInners.push(inner)
      return CB_TOKEN
    })

    let sanitized = sanitizeTelegramHtml(working)

    sanitized = restoreInOrder(sanitized, CB_TOKEN, cbTags.length, (i) => `<${cbTags[i]}>${escapeHtml(cbInners[i] ?? '')}</${cbTags[i]}>`)

    // 7. Truncar tag-aware.
    return truncateTelegramHtml(sanitized, TELEGRAM_MAX_LENGTH)
  } catch {
    try {
      return escapeHtml(raw).slice(0, TELEGRAM_MAX_LENGTH)
    } catch {
      return ''
    }
  }
}
