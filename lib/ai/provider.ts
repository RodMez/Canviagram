import { createOpenAI } from '@ai-sdk/openai'
import { env } from '@/lib/env'

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

export function getLLM(modelId?: string) {
  const provider = getAIProvider()
  if (!provider) throw new Error('AI_API_KEY no configurado — añade AI_API_KEY (o ANTHROPIC_API_KEY fallback) en .env')
  const model = modelId ?? env.AI_MODEL
  return provider(model)
}

export function isAIEnabled(): boolean {
  return Boolean(resolveApiKey())
}

export const aiModelId = env.AI_MODEL
export const aiBaseUrl = env.AI_BASE_URL
