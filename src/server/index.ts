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
import { WebSocketServer } from 'ws'
import type { AgentLedger } from '../ledger/ledger'

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
      const supplied = req.headers['x-agentledger-token']
      if (supplied !== requireToken) {
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
        await ledger.approveGate(token, approved_by)
        res.end(JSON.stringify({ approved: true, token }))
        return
      }

      if (req.method === 'POST' && parts[0] === 'approvals' && parts[2] === 'deny') {
        const body = await readBody(req)
        const token = parts[1] as string
        const denied_by = typeof body.denied_by === 'string' ? body.denied_by : 'dashboard'
        await ledger.denyGate(token, denied_by)
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
      res.statusCode = 500
      res.end(JSON.stringify({ error: String(err) }))
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
      if (supplied !== requireToken) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }
    }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request))
  })

  wss.on('connection', ws => {
    const onEntry = (entry: unknown) => ws.send(JSON.stringify({ type: 'entry', data: entry }))
    const onKill = (ev: unknown) => ws.send(JSON.stringify({ type: 'kill', data: ev }))
    const onEsc = (ev: unknown) => ws.send(JSON.stringify({ type: 'escalation', data: ev }))
    const onAlert = (ev: unknown) => ws.send(JSON.stringify({ type: 'alert', data: ev }))

    ledger.on('entry', onEntry)
    ledger.on('kill', onKill)
    ledger.on('escalation', onEsc)
    ledger.on('alert', onAlert)

    ws.on('close', () => {
      ledger.off('entry', onEntry)
      ledger.off('kill', onKill)
      ledger.off('escalation', onEsc)
      ledger.off('alert', onAlert)
    })
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
        wss.close()
        httpServer.close(() => resolve())
      }),
    httpServer,
    wss,
  }
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise(resolve => {
    let body = ''
    req.on('data', chunk => (body += chunk))
    req.on('end', () => {
      try {
        resolve(JSON.parse(body))
      } catch {
        resolve({})
      }
    })
  })
}
