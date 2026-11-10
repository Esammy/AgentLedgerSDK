/**
 * Dashboard server — optional HTTP + WebSocket server.
 *
 * Usage:
 *   import { createDashboardServer } from '@ai-agent-ledger/sdk/server'
 *   const server = createDashboardServer(ledger, { requireToken: 'secret' })
 *   await server.listen({ port: 4000 })
 *
 * Auth: if `requireToken` is provided, every HTTP and WebSocket request must
 *       supply it as `X-AgentLedger-Token` header (or `?token=` query for WS).
 *       Without `requireToken` the server is fully open — appropriate only
 *       for local development.
 *
 * CORS: by default no Access-Control-Allow-Origin header is sent. Pass
 *       `corsOrigin` to enable browser dashboards from a known origin.
 */

import http from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import { WebSocket, WebSocketServer } from 'ws'
import type { AgentLedger } from '../ledger/ledger'

const MAX_BODY_BYTES = 1024 * 1024

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

/** Constant-time token comparison (hash first so lengths always match). */
function tokenMatches(supplied: unknown, expected: string): boolean {
  if (typeof supplied !== 'string') return false
  const a = createHash('sha256').update(supplied).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

export interface DashboardServerOptions {
  /** Shared secret required on `X-AgentLedger-Token` for all requests. */
  requireToken?: string
  /** Value for `Access-Control-Allow-Origin`. Omit for no CORS header. */
  corsOrigin?: string
}

export function createDashboardServer(
  ledger: AgentLedger,
  options: DashboardServerOptions = {}
) {
  const { requireToken, corsOrigin } = options

  const httpServer = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
    // Fixed base: never trust the Host header, and never let a malformed
    // request URL escape as an unhandled rejection (which kills the process).
    let url: URL
    try {
      url = new URL(req.url ?? '/', 'http://localhost')
    } catch {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'bad request' }))
      return
    }
    const parts = url.pathname.split('/').filter(Boolean)

    res.setHeader('Content-Type', 'application/json')
    if (corsOrigin) {
      res.setHeader('Access-Control-Allow-Origin', corsOrigin)
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-AgentLedger-Token')
      res.setHeader('Vary', 'Origin')
    }

    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }

    if (requireToken) {
      if (!tokenMatches(req.headers['x-agentledger-token'], requireToken)) {
        res.statusCode = 401
        res.end(JSON.stringify({ error: 'unauthorized' }))
        return
      }
    }

    try {
      if (req.method === 'GET' && parts[0] === 'health') {
        res.end(JSON.stringify({ status: 'ok', ts: Date.now() }))
        return
      }

      if (req.method === 'GET' && parts[0] === 'runs' && parts[1] && !parts[2]) {
        const entries = await ledger.storage.query({ run_id: parts[1] })
        res.end(JSON.stringify(entries))
        return
      }

      if (req.method === 'GET' && parts[0] === 'runs' && parts[2] === 'verify') {
        const result = await ledger.storage.verify(parts[1])
        res.end(JSON.stringify(result))
        return
      }

      if (req.method === 'POST' && parts[0] === 'runs' && parts[2] === 'kill') {
        await ledger.killSwitch(parts[1])
        res.end(JSON.stringify({ killed: true, run_id: parts[1], ts: Date.now() }))
        return
      }

      if (req.method === 'POST' && parts[0] === 'approvals' && parts[2] === 'approve') {
        const body = await readBody(req)
        const token = parts[1] as string
        const approved_by = typeof body.approved_by === 'string' ? body.approved_by : 'dashboard'
        if (!(await ledger.approveGate(token, approved_by))) {
          res.statusCode = 404
          res.end(JSON.stringify({ error: 'no pending approval for this token' }))
          return
        }
        res.end(JSON.stringify({ approved: true, token }))
        return
      }

      if (req.method === 'POST' && parts[0] === 'approvals' && parts[2] === 'deny') {
        const body = await readBody(req)
        const token = parts[1] as string
        const denied_by = typeof body.denied_by === 'string' ? body.denied_by : 'dashboard'
        if (!(await ledger.denyGate(token, denied_by))) {
          res.statusCode = 404
          res.end(JSON.stringify({ error: 'no pending approval for this token' }))
          return
        }
        res.end(JSON.stringify({ denied: true, token }))
        return
      }

      if (req.method === 'GET' && parts[0] === 'export' && parts[1]) {
        const entries = await ledger.storage.query({ run_id: parts[1] })
        const format = url.searchParams.get('format') ?? 'json'
        if (format === 'text') {
          res.setHeader('Content-Type', 'text/plain')
          const text = entries
            .map(
              e =>
                `[${new Date(e.ts).toISOString()}] ${e.type.toUpperCase()} risk=${e.risk_score} — ${e.human_summary}`
            )
            .join('\n')
          res.end(text)
        } else {
          res.end(JSON.stringify(entries, null, 2))
        }
        return
      }

      res.statusCode = 404
      res.end(JSON.stringify({ error: 'not found' }))
    } catch (err) {
      if (err instanceof HttpError) {
        res.statusCode = err.status
        res.end(JSON.stringify({ error: err.message }))
        return
      }
      // Don't leak internals to clients; log them server-side instead.
      console.error('[AgentLedger] request failed:', err)
      res.statusCode = 500
      res.end(JSON.stringify({ error: 'internal error' }))
    }
  })

  const wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (request, socket, head) => {
    if (requireToken) {
      let url: URL
      try {
        url = new URL(request.url ?? '/', 'http://localhost')
      } catch {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
        socket.destroy()
        return
      }
      const supplied =
        (request.headers['x-agentledger-token'] as string | undefined) ??
        url.searchParams.get('token') ??
        undefined
      if (!tokenMatches(supplied, requireToken)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }
    }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request))
  })

  // One listener per event for the whole server (not per client), fanning out
  // to open sockets — avoids MaxListenersExceeded warnings with many clients.
  const broadcast = (type: string) => (data: unknown) => {
    const msg = JSON.stringify({ type, data })
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg)
    }
  }
  const listeners: Record<string, (data: unknown) => void> = {
    entry: broadcast('entry'),
    kill: broadcast('kill'),
    escalation: broadcast('escalation'),
    alert: broadcast('alert'),
  }
  for (const [event, fn] of Object.entries(listeners)) ledger.on(event, fn)

  wss.on('connection', ws => {
    // Without an error listener a socket error would crash the process.
    ws.on('error', () => ws.terminate())
  })

  return {
    listen: ({ port = 4000 } = {}) =>
      new Promise<void>(resolve => {
        httpServer.listen(port, () => {
          console.log(`[AgentLedger] Dashboard running on http://localhost:${port}`)
          console.log(`[AgentLedger] WebSocket stream at ws://localhost:${port}/`)
          if (!requireToken) {
            console.warn(
              '[AgentLedger] WARNING: dashboard is UNAUTHENTICATED. Pass { requireToken } before exposing it beyond localhost.'
            )
          }
          resolve()
        })
      }),
    close: () =>
      new Promise<void>(resolve => {
        for (const [event, fn] of Object.entries(listeners)) ledger.off(event, fn)
        // Open sockets/keep-alive connections would otherwise stall shutdown.
        for (const client of wss.clients) client.terminate()
        wss.close()
        httpServer.close(() => resolve())
        httpServer.closeAllConnections?.()
      }),
    httpServer,
    wss,
  }
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        tooLarge = true
        chunks.length = 0
        return // keep draining so the response can still be delivered
      }
      chunks.push(chunk)
    })
    req.on('error', reject)
    req.on('end', () => {
      if (tooLarge) return reject(new HttpError(413, 'request body too large'))
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text.trim()) return resolve({})
      try {
        const parsed: unknown = JSON.parse(text)
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return reject(new HttpError(400, 'body must be a JSON object'))
        }
        resolve(parsed as Record<string, unknown>)
      } catch {
        reject(new HttpError(400, 'invalid JSON body'))
      }
    })
  })
}
