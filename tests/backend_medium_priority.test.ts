import { describe, it, expect } from 'vitest'
import type { AddressInfo } from 'node:net'
import { WebSocket } from 'ws'
import { AgentLedger } from '../src/ledger/ledger'
import { createDashboardServer } from '../src/server'
import { POLICY_TEMPLATES } from '../src/policy/templates'
import { KillSwitchError } from '../src/errors/errors'

function gatedLedger() {
  const ledger = new AgentLedger({
    agent_id: 'a',
    storage: { type: 'memory' },
    policies: [POLICY_TEMPLATES.external_email_gate('corp.com')],
  })
  const agent = ledger.wrap({
    tools: [{ name: 'send_email', description: '', func: async () => 'sent' }],
  })
  const tokens: string[] = []
  ledger.on('entry', e => {
    const p = e.payload as { override_token?: string; resolution?: string }
    if (e.type === 'approval_gate' && !p.resolution && p.override_token) tokens.push(p.override_token)
  })
  return { ledger, agent, tokens }
}

const tick = () => new Promise(r => setTimeout(r, 10))

describe('approval gates', () => {
  it('records who approved in the ledger', async () => {
    const { ledger, agent, tokens } = gatedLedger()
    const call = ledger.run(() => agent.tools![0].func({ to: 'x@other.com' }), 'r')
    await tick()
    expect(await ledger.approveGate(tokens[0], 'alice')).toBe(true)
    await call
    await ledger.flush()
    const entries = await ledger.storage.query({ run_id: 'r', type: 'approval_gate' })
    const resolved = entries.map(e => e.payload as { resolution?: string; resolved_by?: string })
    expect(resolved.at(-1)).toMatchObject({ resolution: 'approved', resolved_by: 'alice' })
    expect(entries.at(-1)!.human_summary).toContain('APPROVAL APPROVED')
    expect((await ledger.storage.verify('r')).valid).toBe(true)
  })

  it('approve/deny return false for unknown or already-used tokens', async () => {
    const { ledger, agent, tokens } = gatedLedger()
    expect(await ledger.approveGate('nope', 'x')).toBe(false)
    const call = ledger.run(() => agent.tools![0].func({ to: 'x@other.com' }), 'r')
    await tick()
    expect(await ledger.denyGate(tokens[0], 'bob')).toBe(true)
    await expect(call).rejects.toThrow('denied by bob')
    expect(await ledger.denyGate(tokens[0], 'bob')).toBe(false)
  })

  it('kill switch releases a pending gate immediately', async () => {
    const { ledger, agent } = gatedLedger()
    const call = ledger.run(() => agent.tools![0].func({ to: 'x@other.com' }), 'r')
    const settled = expect(call).rejects.toThrow('kill_switch')
    await tick()
    await ledger.killSwitch('r')
    await settled
    await ledger.flush()
    const gates = await ledger.storage.query({ run_id: 'r', type: 'approval_gate' })
    expect((gates.at(-1)!.payload as { resolution?: string }).resolution).toBe('kill_switch')
  })
})

describe('kill switch covers LLM calls', () => {
  it('halted run cannot invoke the wrapped llm', async () => {
    const ledger = new AgentLedger({ agent_id: 'a', storage: { type: 'memory' } })
    const agent = ledger.wrap({ llm: { invoke: async () => ({ model: 'm' }) } })
    await ledger.killSwitch('r')
    await expect(ledger.run(() => agent.llm!.invoke('hi'), 'r')).rejects.toBeInstanceOf(KillSwitchError)
  })
})

describe('unserializable args', () => {
  it('a blocked call with circular args still raises PolicyBlockError', async () => {
    const ledger = new AgentLedger({
      agent_id: 'a',
      storage: { type: 'memory' },
      policies: [POLICY_TEMPLATES.no_spend_over(1)],
    })
    const agent = ledger.wrap({
      tools: [{ name: 'charge_card', description: '', func: async () => 'ok' }],
    })
    const circular: Record<string, unknown> = { amount: 1000 }
    circular.self = circular
    await expect(
      ledger.run(() => agent.tools![0].func(circular), 'r')
    ).rejects.toMatchObject({ name: 'PolicyBlockError' })
  })
})

describe('flush / close', () => {
  it('flush waits for fire-and-forget tool_call entries', async () => {
    const ledger = new AgentLedger({ agent_id: 'a', storage: { type: 'memory' } })
    const agent = ledger.wrap({
      tools: [{ name: 't', description: '', func: async () => 1 }],
    })
    await ledger.run(() => agent.tools![0].func(), 'r')
    await ledger.flush()
    expect(await ledger.storage.query({ run_id: 'r' })).toHaveLength(1)
    await ledger.close()
  })
})

describe('chain head cache is bounded', () => {
  it('runs evicted from the cache keep a valid chain via storage recovery', async () => {
    const ledger = new AgentLedger({ agent_id: 'a', storage: { type: 'memory' } })
    const rec = (run_id: string) =>
      ledger.record({
        agent_id: 'a',
        run_id,
        ts: 1,
        type: 'tool_call',
        risk_score: 0,
        payload: { tool_name: 't', tool_input: [], duration_ms: 1, data_classifications: [] },
      })
    await rec('first')
    const heads = (ledger as unknown as { chainHeads: Map<string, string> }).chainHeads
    heads.delete('first') // simulate eviction
    await rec('first')
    expect((await ledger.storage.verify('first')).valid).toBe(true)
  })
})

describe('dashboard server hardening', () => {
  async function start(opts = {}) {
    const ledger = new AgentLedger({ agent_id: 'a', storage: { type: 'memory' } })
    const server = createDashboardServer(ledger, opts)
    await server.listen({ port: 0 })
    const port = (server.httpServer.address() as AddressInfo).port
    return { ledger, server, base: `http://127.0.0.1:${port}`, port }
  }

  it('returns 404 when approving an unknown token', async () => {
    const { server, base } = await start()
    try {
      const res = await fetch(`${base}/approvals/nope/approve`, { method: 'POST' })
      expect(res.status).toBe(404)
    } finally {
      await server.close()
    }
  })

  it('rejects invalid JSON with 400 and oversized bodies with 413', async () => {
    const { server, base } = await start()
    try {
      const bad = await fetch(`${base}/approvals/t/approve`, { method: 'POST', body: '{nope' })
      expect(bad.status).toBe(400)
      const big = await fetch(`${base}/approvals/t/approve`, {
        method: 'POST',
        body: JSON.stringify({ approved_by: 'x'.repeat(2 * 1024 * 1024) }),
      })
      expect(big.status).toBe(413)
    } finally {
      await server.close()
    }
  })

  it('does not leak internal error text on 500', async () => {
    const { ledger, server, base } = await start()
    ;(ledger.storage as unknown as { query: () => never }).query = () => {
      throw new Error('SECRET /var/db/path')
    }
    try {
      const res = await fetch(`${base}/runs/r1`)
      expect(res.status).toBe(500)
      expect(await res.text()).not.toContain('SECRET')
    } finally {
      await server.close()
    }
  })

  it('token check still accepts/rejects correctly', async () => {
    const { server, base } = await start({ requireToken: 'abc' })
    try {
      expect((await fetch(`${base}/health`, { headers: { 'X-AgentLedger-Token': 'abd' } })).status).toBe(401)
      expect((await fetch(`${base}/health`, { headers: { 'X-AgentLedger-Token': 'abc' } })).status).toBe(200)
    } finally {
      await server.close()
    }
  })

  it('supports many websocket clients without listener leaks and close() terminates them', async () => {
    const { ledger, server, port } = await start()
    const warnings: string[] = []
    const onWarn = (w: Error) => warnings.push(w.name)
    process.on('warning', onWarn)
    const clients: WebSocket[] = []
    for (let i = 0; i < 15; i++) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`)
      await new Promise(r => ws.once('open', r))
      clients.push(ws)
    }
    const received = new Promise<string>(resolve => clients[14].once('message', m => resolve(String(m))))
    await ledger.record({
      agent_id: 'a',
      run_id: 'r',
      ts: 1,
      type: 'tool_call',
      risk_score: 0,
      payload: { tool_name: 't', tool_input: [], duration_ms: 1, data_classifications: [] },
    })
    expect(JSON.parse(await received).type).toBe('entry')

    const closed = Promise.all(clients.map(c => new Promise(r => c.once('close', r))))
    await server.close() // must not hang on open sockets
    await closed
    process.off('warning', onWarn)
    expect(warnings).not.toContain('MaxListenersExceededWarning')
    expect(ledger.listenerCount('entry')).toBe(0)
  })
})
