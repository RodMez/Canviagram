import { createOpenAI } from '@ai-sdk/openai'
import { env } from '@/lib/env'
import { getAiSettings, notifyAdminsOfFallback } from '@/lib/ai/settings'

function resolveApiKey(): string | undefined {
  return env.AI_API_KEY
}

export function getAIProvider() {
  const apiKey = resolveApiKey()
  if (!apiKey) return null
  return createOpenAI({
    apiKey,
    baseURL: env.AI_BASE_URL,
    headers: {
      'HTTP-Referer': 'https://canviagram.jaiver.com',
      'X-Title': 'Canviagram',
    },
  })
}

export type AIModel = ReturnType<NonNullable<ReturnType<typeof getAIProvider>>>

export function getLLM(modelId?: string) {
  const provider = getAIProvider()
  if (!provider) throw new Error('AI_API_KEY no configurado — añade AI_API_KEY (o ANTHROPIC_API_KEY fallback) en .env')
  const model = modelId ?? env.AI_MODEL
  return provider(model)
}

/**
 * ¿El error es de la familia "modelo no disponible"? (F5.5)
 * Cubre: modelo dado de baja en OpenRouter (404/400 "model not found")
 * y rate-limit del free tier (429). Heurística sobre el shape de error
 * del AI SDK (APICallError.statusCode) + mensaje; calibrar contra
 * errores reales si aparecen falsos positivos (ver gap en DESIGN_F5.5).
 */
export function isModelUnavailableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const statusCode = (err as { statusCode?: unknown }).statusCode
  if (statusCode === 404 || statusCode === 429) return true
  const message = [ (err as { message?: unknown }).message ]
    .filter((m): m is string => typeof m === 'string')
    .join(' ')
    .toLowerCase()
  if (!message) return false
  if (/model.{0,20}(not found|not exist|no longer|deprecated|not available)/.test(message)) return true
  if (statusCode === 400 && /model/.test(message)) return true
  if (/rate.?limit|too many requests|quota|429/.test(message)) return true
  return false
}

/**
 * Ejecuta fn con el modelo activo y cae a los fallbacks si el modelo
 * no está disponible (F5.5). Estrategia "free primero, pago si falla":
 * se intenta el primario en CADA request (auto-regenerativo cuando el
 * free tier recupera cupo). Al primer fallback avisa a los admins por
 * Telegram (no bloqueante). Sin AI_API_KEY lanza igual que antes.
 *
 * Nota: con streamText los errores que ocurren DURANTE el stream
 * (post-headers) no pueden reintentarse; el fallback cubre fallos de
 * resolución del modelo. generateText (Telegram) sí reintenta completo.
 */
export async function callWithFallback<T>(fn: (model: AIModel) => Promise<T> | T): Promise<T> {
  const provider = getAIProvider()
  if (!provider) throw new Error('AI_API_KEY no configurado — añade AI_API_KEY (o ANTHROPIC_API_KEY fallback) en .env')
  const { model: primary, fallback } = await getAiSettings()
  const candidates = [primary, ...fallback]

  let lastError: unknown
  for (const modelId of candidates) {
    try {
      return await fn(provider(modelId))
    } catch (err) {
      lastError = err
      if (!isModelUnavailableError(err)) throw err
      if (modelId === primary) {
        const next = candidates[1]
        void notifyAdminsOfFallback(modelId, next).catch(() => {})
      }
      // seguir al siguiente candidato
    }
  }
  throw lastError
}

export function isAIEnabled(): boolean {
  return Boolean(resolveApiKey())
}

export const aiModelId = env.AI_MODEL
export const aiBaseUrl = env.AI_BASE_URL
