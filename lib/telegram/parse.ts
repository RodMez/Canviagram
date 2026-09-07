import { z } from 'zod'
import { NODE_TYPES, NODE_STATUSES } from '@/lib/db/schema'

// ============================================================
// Parse robusto de la respuesta JSON del LLM en Telegram.
//
// Motivación: generateObject + openrouter/free fallaba con
// AI_NoObjectGeneratedError. Ahora usamos generateText y parseamos
// el texto aquí: extraemos el bloque JSON, lo validamos con Zod y
// devolvemos null ante cualquier fallo (el bot pide de nuevo, nunca crashea).
// ============================================================

export const telegramParseSchema = z.object({
  shouldCreate: z.boolean(),
  node: z
    .object({
      type: z.enum(NODE_TYPES),
      title: z.string().min(1).max(200),
      content: z.string().max(5000).nullish(),
      status: z.enum(NODE_STATUSES).nullish(),
    })
    .nullish(),
  reply: z.string().max(2000).nullish(),
})

export type TelegramParseResult = z.infer<typeof telegramParseSchema>

/**
 * Extrae el primer objeto JSON válido del texto del modelo.
 * Tolera fences markdown (```json ... ```), texto sobrante alrededor y
 * JSON anidado. Devuelve null si no hay objeto parseable.
 */
export function extractJsonObject(raw: string): unknown {
  const text = raw.trim()
  if (!text) return null

  // Despejar fences markdown (```json ... ``` o ``` ... ```)
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1].trim() : text

  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null

  const json = candidate.slice(start, end + 1)
  try {
    return JSON.parse(json) as unknown
  } catch {
    return null
  }
}

/**
 * Valida y normaliza la respuesta LLM contra el schema de transporte.
 * Retorna null si no hay JSON válido o no cumple el schema → el bot
 * pregunta de nuevo en vez de reventar.
 */
export function parseTelegramNode(raw: string): TelegramParseResult | null {
  const candidate = extractJsonObject(raw)
  if (candidate === null) return null
  const result = telegramParseSchema.safeParse(candidate)
  return result.success ? result.data : null
}