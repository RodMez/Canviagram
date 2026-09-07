export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { getSession } from '@/lib/auth/session'
import { assertWorkspaceAccess } from '@/lib/auth/workspace-access'
import { subscribe, unsubscribe } from '@/lib/sse/pubsub'

const HEARTBEAT_INTERVAL_MS = 25_000

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()
  if (!session) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    await assertWorkspaceAccess(id, session.userId, 'viewer')
  } catch {
    return new Response(JSON.stringify({ error: 'Acceso denegado' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const encoder = new TextEncoder()
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller
      subscribe(id, controller)

      controller.enqueue(
        encoder.encode(`event: connected\ndata: ${JSON.stringify({ workspaceId: id })}\n\n`)
      )

      heartbeatTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
        } catch {
          cleanup()
        }
      }, HEARTBEAT_INTERVAL_MS)
    },
    cancel() {
      cleanup()
    },
  })

  function cleanup() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
    if (controllerRef) {
      try {
        unsubscribe(id, controllerRef)
      } catch {
        // controller may already be closed
      }
      try {
        controllerRef.close()
      } catch {
        // controller may already be closed
      }
      controllerRef = null
    }
  }

  request.signal.addEventListener('abort', cleanup)

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
