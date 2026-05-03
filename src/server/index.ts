/**
 * Dashboard server — optional HTTP + WebSocket server.
 *
 * Usage:
 *   import { createDashboardServer } from '@agentledger/sdk/server'
 *   const server = createDashboardServer(ledger)
 *   await server.listen({ port: 4000 })
 */

import type { AgentLedger } from '../ledger/ledger'

export function createDashboardServer(ledger: AgentLedger) {
  const http = require('http') as typeof import('http')
  const { WebSocketServer } = require('ws') as typeof import('ws')

  const httpServer = http.createServer(async (req: import('http').IncomingMessage, res: import('http').ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const parts = url.pathname.split('/').filter(Boolean)

    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Access-Control-Allow-Origin', '*')

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

  const wss = new WebSocketServer({ server: httpServer })
  wss.on('connection', ws => {
    const onEntry = (entry: unknown) => ws.send(JSON.stringify({ type: 'entry', data: entry }))
    const onKill = (ev: unknown) => ws.send(JSON.stringify({ type: 'kill', data: ev }))
    const onEsc = (ev: unknown) => ws.send(JSON.stringify({ type: 'escalation', data: ev }))

    ledger.on('entry', onEntry)
    ledger.on('kill', onKill)
    ledger.on('escalation', onEsc)

    ws.on('close', () => {
      ledger.off('entry', onEntry)
      ledger.off('kill', onKill)
      ledger.off('escalation', onEsc)
    })
  })

  return {
    listen: ({ port = 4000 } = {}) =>
      new Promise<void>(resolve => {
        httpServer.listen(port, () => {
          console.log(`[AgentLedger] Dashboard running on http://localhost:${port}`)
          console.log(`[AgentLedger] WebSocket stream at ws://localhost:${port}/stream`)
          resolve()
        })
      }),
    close: () => new Promise<void>(resolve => httpServer.close(() => resolve())),
    httpServer,
    wss,
  }
}

function readBody(req: import('http').IncomingMessage): Promise<Record<string, unknown>> {
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

