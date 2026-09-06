import { describe, it, expect, vi } from 'vitest'
import {
  parseSseDataLines,
  extractAssistantText,
  consumeUIMessageStream,
} from '@/lib/ai/ui-message-stream'
import type { UIMessage } from 'ai'

// ============================================================
// M2: consumo del UIMessageStream (Diseño 10.3)
// Verifica que el cliente interpreta el formato SSE que emite el
// server (createUIMessageStreamResponse): chunks JSON `data: <json>\n\n`
// terminados con `data: [DONE]\n\n`.
// ============================================================

describe('parseSseDataLines (framing SSE del UIMessageStream)', () => {
  it('parsea chunks JSON de eventos data:', () => {
    const sse = 'data: {"type":"start","messageId":"m1"}\n\ndata: {"type":"text-delta","delta":"Hola"}\n\n'
    expect(parseSseDataLines(sse)).toEqual([
      { type: 'start', messageId: 'm1' },
      { type: 'text-delta', delta: 'Hola' },
    ])
  })

  it('ignora el marcador [DONE] de cierre', () => {
    const sse = 'data: {"type":"finish"}\n\ndata: [DONE]\n\n'
    expect(parseSseDataLines(sse)).toEqual([{ type: 'finish' }])
  })

  it('ignora líneas malformadas sin romper el resto', () => {
    const sse = 'data: {json invalido\n\ndata: {"type":"text-delta","delta":"ok"}\n\n'
    expect(parseSseDataLines(sse)).toEqual([{ type: 'text-delta', delta: 'ok' }])
  })

  it('devuelve array vacío para texto sin eventos data:', () => {
    expect(parseSseDataLines('')).toEqual([])
    expect(parseSseDataLines('event: foo\n')).toEqual([])
  })
})

describe('extractAssistantText (texto acumulado del UIMessage)', () => {
  it('concatena los parts de tipo text', () => {
    const message = {
      id: 'm1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Hola ' },
        { type: 'text', text: 'mundo' },
      ],
    } as unknown as UIMessage
    expect(extractAssistantText(message)).toBe('Hola mundo')
  })

  it('ignora tool parts (no se muestran como texto)', () => {
    const message = {
      id: 'm1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Creando nodo…' },
        // Wire v7 (ai@7.0.90): part de tool estático `tool-<name>` con
        // state 'output-available' y resultado en `output`.
        { type: 'tool-createNode', toolCallId: 't1', state: 'output-available', output: { id: 'n-1' } },
      ],
    } as unknown as UIMessage
    expect(extractAssistantText(message)).toBe('Creando nodo…')
  })

  it('devuelve string vacío sin parts de texto', () => {
    const message = { id: 'm1', role: 'assistant', parts: [] } as unknown as UIMessage
    expect(extractAssistantText(message)).toBe('')
  })
})

describe('consumeUIMessageStream (contrato server ↔ client)', () => {
  it('acumula el texto del asistente desde un body SSE real', async () => {
    // Simula el body que produce createUIMessageStreamResponse (F3.4d):
    // SSE de chunks JSON (text-start → text-delta* → text-end) terminado con [DONE].
    const sse =
      'data: {"type":"start","messageId":"m1"}\n\n' +
      'data: {"type":"text-start","id":"text-1"}\n\n' +
      'data: {"type":"text-delta","id":"text-1","delta":"Hola"}\n\n' +
      'data: {"type":"text-delta","id":"text-1","delta":" mundo"}\n\n' +
      'data: {"type":"text-end","id":"text-1"}\n\n' +
      'data: {"type":"finish"}\n\n' +
      'data: [DONE]\n\n'
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse))
        controller.close()
      },
    })

    const texts: string[] = []
    await consumeUIMessageStream(body, (text) => texts.push(text))

    // El último snapshot debe contener el texto completo acumulado.
    expect(texts.length).toBeGreaterThan(0)
    expect(texts[texts.length - 1]).toBe('Hola mundo')
  })

  it('resuelve sin error ante un body vacío', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close()
      },
    })
    const onText = vi.fn()
    await consumeUIMessageStream(body, onText)
    expect(onText).not.toHaveBeenCalled()
  })
})
