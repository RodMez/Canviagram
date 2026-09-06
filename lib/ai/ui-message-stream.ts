import { readUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai'

// ============================================================
// Consumo del UIMessageStream (M2, Diseño 10.3)
//
// El route /api/ai/chat responde con `createUIMessageStreamResponse`
// (F3.4d): un SSE de chunks JSON (`data: <json>\n\n`, terminado con
// `data: [DONE]\n\n`). Cada payload es un `UIMessageChunk` del SDK ai v7.
//
// El SDK expone `readUIMessageStream({ stream })` que consume un
// `ReadableStream<UIMessageChunk>` y emite snapshots de `UIMessage`
// (el estado completo del mensaje en cada actualización). NO emite
// chunks crudos: por eso aquí extraemos el texto de `message.parts`.
//
// NOTA (desviación del diseño del coordinador): `readUIMessageStream`
// NO acepta un reader crudo de `res.body`; requiere un
// `ReadableStream<UIMessageChunk>`. Como `res.body` es un byte stream
// SSE, lo parseamos aquí (framing SSE estándar) y lo re-empaquetamos
// en un `ReadableStream<UIMessageChunk>` antes de pasarlo al SDK.
// ============================================================

/**
 * Parsea el framing SSE de un bloque de texto en valores JSON.
 * Cada evento es `data: <json>\n\n`; el final es `data: [DONE]\n\n`.
 * Puro y testable sin DOM.
 */
export function parseSseDataLines(text: string): unknown[] {
  const chunks: unknown[] = []
  for (const block of text.split('\n\n')) {
    const dataLine = block
      .split('\n')
      .find((line) => line.startsWith('data:'))
    if (!dataLine) continue
    const payload = dataLine.slice('data:'.length).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      chunks.push(JSON.parse(payload))
    } catch {
      // Evento malformado: se ignora para no romper el stream.
    }
  }
  return chunks
}

/**
 * Extrae el texto acumulado de un snapshot `UIMessage` del SDK.
 * Los parts de tipo 'text' contienen el texto del asistente.
 * Puro y testable sin DOM.
 */
export function extractAssistantText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => (part as { text: string }).text)
    .join('')
}

/**
 * Consume el body SSE de la respuesta de /api/ai/chat y llama a
 * `onText` con el texto acumulado del asistente en cada actualización.
 * Los tool calls NO se muestran como texto (el canvas los refleja vía
 * SSE applyEvent); aquí solo nos interesa el texto del asistente.
 *
 * `options.onMessage` (F4.1c): callback opcional con el snapshot
 * `UIMessage` completo en cada actualización — lo usa el modo demo
 * para traducir tool-result parts a eventos locales (applyLocalEvent).
 * Backward-compatible: los callers actuales no pasan options.
 */
export async function consumeUIMessageStream(
  body: ReadableStream<Uint8Array>,
  onText: (text: string) => void,
  options?: { onMessage?: (message: UIMessage) => void }
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  // Re-empaqueta los chunks SSE parseados en un ReadableStream<UIMessageChunk>
  // que es lo que readUIMessageStream espera consumir.
  const chunkStream = new ReadableStream<UIMessageChunk>({
    async start(controller) {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let sepIndex: number
          while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, sepIndex)
            buffer = buffer.slice(sepIndex + 2)
            for (const parsed of parseSseDataLines(block)) {
              controller.enqueue(parsed as UIMessageChunk)
            }
          }
        }
        // Flush del buffer restante al cerrar el stream.
        for (const parsed of parseSseDataLines(buffer)) {
          controller.enqueue(parsed as UIMessageChunk)
        }
        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })

  const stream = readUIMessageStream({ stream: chunkStream })
  for await (const message of stream) {
    options?.onMessage?.(message)
    onText(extractAssistantText(message))
  }
}
