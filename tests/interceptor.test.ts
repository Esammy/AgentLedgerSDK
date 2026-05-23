import { describe, it, expect } from 'vitest'
import { AgentLedger } from '../src/ledger/ledger'
import { POLICY_TEMPLATES } from '../src/policy/templates'
import {
  PolicyBlockError,
  ApprovalDeniedError,
  KillSwitchError,
} from '../src/errors/errors'

const settle = () => new Promise(r => setTimeout(r, 30))

describe('Interceptor', () => {
  it('does not double-wrap a tool when ledger.wrap is called twice', async () => {
    const ledger = new AgentLedger({ agent_id: 'a', storage: { type: 'memory' } })
    const agent = {
      id: 'x',
      tools: [{ name: 'noop', description: '', func: async () => 'ok' }],
    }
    ledger.wrap(agent)
    ledger.wrap(agent) // second wrap should be a no-op per tool

    await ledger.run(async () => {
      await agent.tools[0].func()
    }, 'r')
    await settle()

    const entries = await ledger.storage.query({ run_id: 'r' })
    expect(entries.length).toBe(1) // not 2
  })

  it('throws KillSwitchError after a scoped kill', async () => {
    const ledger = new AgentLedger({ agent_id: 'a', storage: { type: 'memory' } })
    const agent = ledger.wrap({
      tools: [{ name: 'noop', description: '', func: async () => 'ok' }],
    })

    await ledger.killSwitch('r1')

    await expect(
      ledger.run(async () => {
        await agent.tools![0].func()
      }, 'r1')
    ).rejects.toBeInstanceOf(KillSwitchError)

    // Other runs are unaffected.
    await expect(
      ledger.run(async () => {
        return agent.tools![0].func()
      }, 'r2')
    ).resolves.toBe('ok')
  })

  it('global kill switch halts every run', async () => {
    const ledger = new AgentLedger({ agent_id: 'a', storage: { type: 'memory' } })
    const agent = ledger.wrap({
      tools: [{ name: 'noop', description: '', func: async () => 'ok' }],
    })

    await ledger.killSwitch()

    await expect(
      ledger.run(async () => {
        await agent.tools![0].func()
      }, 'whatever')
    ).rejects.toBeInstanceOf(KillSwitchError)
  })

  it('approval gate: deny throws ApprovalDeniedError', async () => {
    const ledger = new AgentLedger({
      agent_id: 'a',
      storage: { type: 'memory' },
      policies: [POLICY_TEMPLATES.external_email_gate('corp.com')],
    })
    const agent = ledger.wrap({
      tools: [
        {
          name: 'send_email',
          description: '',
          func: async () => 'sent',
        },
      ],
    })

    ledger.on('entry', e => {
      if (e.type !== 'approval_gate') return
      const token = (e.payload as { override_token?: string }).override_token
      if (token) setTimeout(() => void ledger.denyGate(token, 'human'), 0)
    })

    await expect(
      ledger.run(async () => {
        await agent.tools![0].func({ to: 'x@other.com' })
      }, 'r')
    ).rejects.toBeInstanceOf(ApprovalDeniedError)
  })

  it('approval gate timer does not keep the event loop alive', async () => {
    // We can't truly assert process exit, but we can assert the resolver
    // clears the timer by approving and seeing the call complete fast.
    const ledger = new AgentLedger({
      agent_id: 'a',
      storage: { type: 'memory' },
      policies: [POLICY_TEMPLATES.external_email_gate('corp.com')],
    })
    const agent = ledger.wrap({
      tools: [{ name: 'send_email', description: '', func: async () => 'sent' }],
    })

    ledger.on('entry', e => {
      if (e.type !== 'approval_gate') return
      const token = (e.payload as { override_token?: string }).override_token
      if (token) setTimeout(() => void ledger.approveGate(token, 'human'), 0)
    })

    const start = Date.now()
    await ledger.run(async () => {
      await agent.tools![0].func({ to: 'x@other.com' })
    }, 'r')
    expect(Date.now() - start).toBeLessThan(500) // not waiting on 30-min timer
  })

  it('alert action does not block the call but emits alert event', async () => {
    const ledger = new AgentLedger({
      agent_id: 'a',
      storage: { type: 'memory' },
      policies: [POLICY_TEMPLATES.pii_write_alert(['#sec'])],
    })
    const agent = ledger.wrap({
      tools: [{ name: 'write_file', description: '', func: async () => 'wrote' }],
    })

    let alertEv: unknown
    ledger.on('alert', e => (alertEv = e))

    const result = await ledger.run(
      () => agent.tools![0].func({ path: '/x', content: 'alice@corp.com' }),
      'r'
    )

    expect(result).toBe('wrote')
    expect(alertEv).toBeDefined()
    expect((alertEv as { policy_id: string }).policy_id).toBe('pii_write_alert')
  })

  it('policy_block throws PolicyBlockError and records an entry', async () => {
    const ledger = new AgentLedger({
      agent_id: 'a',
      storage: { type: 'memory' },
      policies: [POLICY_TEMPLATES.no_spend_over(500)],
    })
    const agent = ledger.wrap({
      tools: [
        {
          name: 'create_payment',
          description: '',
          func: async () => 'ok',
        },
      ],
    })

    await expect(
      ledger.run(() => agent.tools![0].func({ amount: 5000 }), 'r')
    ).rejects.toBeInstanceOf(PolicyBlockError)

    await settle()
    const entries = await ledger.storage.query({ run_id: 'r' })
    expect(entries.length).toBe(1)
    expect(entries[0].type).toBe('policy_block')
  })
})
