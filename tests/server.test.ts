import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { AgentLedger } from '../src/ledger/ledger'
import { createDashboardServer } from '../src/server/index'
import type { AddressInfo } from 'net'

describe('Dashboard server', () => {
  describe('with requireToken', () => {
    let ledger: AgentLedger
    let server: ReturnType<typeof createDashboardServer>
    let baseUrl: string

    beforeAll(async () => {
      ledger = new AgentLedger({ agent_id: 'a', storage: { type: 'memory' } })
      server = createDashboardServer(ledger, { requireToken: 's3cret', corsOrigin: 'https://x.io' })
      await server.listen({ port: 0 })
      const addr = server.httpServer.address() as AddressInfo
      baseUrl = `http://127.0.0.1:${addr.port}`
    })

    afterAll(async () => {
      await server.close()
    })

    it('rejects requests without token', async () => {
      const res = await fetch(`${baseUrl}/health`)
      expect(res.status).toBe(401)
    })

    it('accepts requests with the correct token', async () => {
      const res = await fetch(`${baseUrl}/health`, {
        headers: { 'X-AgentLedger-Token': 's3cret' },
      })
      expect(res.status).toBe(200)
    })

    it('handles OPTIONS preflight without requiring token', async () => {
      const res = await fetch(`${baseUrl}/health`, { method: 'OPTIONS' })
      expect(res.status).toBe(204)
      expect(res.headers.get('access-control-allow-origin')).toBe('https://x.io')
    })

    it('rejects POST /runs/:id/kill without token', async () => {
      const res = await fetch(`${baseUrl}/runs/r1/kill`, { method: 'POST' })
      expect(res.status).toBe(401)
    })
  })

  describe('without requireToken (dev mode)', () => {
    let ledger: AgentLedger
    let server: ReturnType<typeof createDashboardServer>
    let baseUrl: string

    beforeAll(async () => {
      ledger = new AgentLedger({ agent_id: 'a', storage: { type: 'memory' } })
      server = createDashboardServer(ledger)
      await server.listen({ port: 0 })
      const addr = server.httpServer.address() as AddressInfo
      baseUrl = `http://127.0.0.1:${addr.port}`
    })

    afterAll(async () => {
      await server.close()
    })

    it('serves /health without auth', async () => {
      const res = await fetch(`${baseUrl}/health`)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.status).toBe('ok')
    })

    it('does not send a CORS header when corsOrigin is omitted', async () => {
      const res = await fetch(`${baseUrl}/health`)
      expect(res.headers.get('access-control-allow-origin')).toBeNull()
    })
  })
})
