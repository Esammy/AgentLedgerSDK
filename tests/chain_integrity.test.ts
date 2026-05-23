import { describe, it, expect } from 'vitest'
import { AgentLedger } from '../src/ledger/ledger'
import { verifyChain } from '../src/storage/storage'
import type { LedgerEntry } from '../src/ledger/types'

async function settle() {
  await new Promise(r => setTimeout(r, 50))
}

describe('Hash chain integrity', () => {
  it('verifies per-run chains correctly when runs interleave', async () => {
    const ledger = new AgentLedger({
      agent_id: 'a',
      storage: { type: 'memory' },
    })

    const agent = ledger.wrap({
      tools: [
        {
          name: 'noop',
          description: 'no-op',
          func: async (...args: unknown[]) => {
            // Yield to let other runs interleave their records into the queue.
            await new Promise(r => setTimeout(r, Math.random() * 5))
            return args[0]
          },
        },
      ],
    })

    // Interleave two runs heavily.
    const runA = ledger.run(async () => {
      for (let i = 0; i < 10; i++) await agent.tools![0].func(`A-${i}`)
    }, 'run-A')
    const runB = ledger.run(async () => {
      for (let i = 0; i < 10; i++) await agent.tools![0].func(`B-${i}`)
    }, 'run-B')
    await Promise.all([runA, runB])
    await settle()

    const a = await ledger.storage.verify('run-A')
    const b = await ledger.storage.verify('run-B')
    expect(a.valid).toBe(true)
    expect(a.entry_count).toBe(10)
    expect(b.valid).toBe(true)
    expect(b.entry_count).toBe(10)
  })

  it('detects tampering with a non-payload field (ts)', async () => {
    const ledger = new AgentLedger({
      agent_id: 'a',
      storage: { type: 'memory' },
    })
    const agent = ledger.wrap({
      tools: [{ name: 'noop', description: '', func: async () => 'ok' }],
    })

    await ledger.run(async () => {
      await agent.tools![0].func()
      await agent.tools![0].func()
    }, 'run-X')
    await settle()

    const entries = await ledger.storage.query({ run_id: 'run-X' })
    expect(entries.length).toBe(2)

    // Tamper with ts on the second entry only.
    const tampered: LedgerEntry[] = entries.map((e, i) =>
      i === 1 ? { ...e, ts: e.ts + 999999 } : e
    )
    const result = verifyChain(tampered)
    expect(result.valid).toBe(false)
    expect(result.broken_at).toBe(1)
  })

  it('detects tampering with run_id', async () => {
    const ledger = new AgentLedger({
      agent_id: 'a',
      storage: { type: 'memory' },
    })
    const agent = ledger.wrap({
      tools: [{ name: 'noop', description: '', func: async () => 'ok' }],
    })

    await ledger.run(async () => {
      await agent.tools![0].func()
    }, 'run-Y')
    await settle()

    const entries = await ledger.storage.query({ run_id: 'run-Y' })
    const tampered = entries.map(e => ({ ...e, run_id: 'attacker-renamed' }))
    const result = verifyChain(tampered)
    expect(result.valid).toBe(false)
  })

  it('verifies a clean single-run chain', async () => {
    const ledger = new AgentLedger({
      agent_id: 'a',
      storage: { type: 'memory' },
    })
    const agent = ledger.wrap({
      tools: [{ name: 'noop', description: '', func: async (x: unknown) => x }],
    })

    await ledger.run(async () => {
      for (let i = 0; i < 5; i++) await agent.tools![0].func(i)
    }, 'solo')
    await settle()

    const result = await ledger.storage.verify('solo')
    expect(result.valid).toBe(true)
    expect(result.entry_count).toBe(5)
  })
})
