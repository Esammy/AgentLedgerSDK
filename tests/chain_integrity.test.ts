import { describe, it, expect } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { rm } from 'fs/promises'
import { AgentLedger } from '../src/ledger/ledger'
import { verifyChain } from '../src/storage/storage'
import type { LedgerEntry } from '../src/ledger/types'

async function settle() {
  await new Promise(r => setTimeout(r, 50))
}

/** Build a ledger with N noop tool calls recorded under run_id. */
async function seededLedger(run_id: string, calls = 4): Promise<AgentLedger> {
  const ledger = new AgentLedger({ agent_id: 'a', storage: { type: 'memory' } })
  const agent = ledger.wrap({
    tools: [{ name: 'noop', description: '', func: async (x: unknown) => x }],
  })
  await ledger.run(async () => {
    for (let i = 0; i < calls; i++) await agent.tools![0].func(i)
  }, run_id)
  await settle()
  return ledger
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

  it('detects a deleted entry in the middle of a run', async () => {
    const ledger = await seededLedger('run-del')
    const entries = await ledger.storage.query({ run_id: 'run-del' })
    expect(entries.length).toBe(4)

    // Every entry is individually intact, so per-entry hashing alone would
    // pass — only the prev_id linkage exposes the gap.
    const withDeletion = [entries[0], entries[2], entries[3]]
    const result = verifyChain(withDeletion)
    expect(result.valid).toBe(false)
    expect(result.broken_at).toBe(1)
    expect(result.reason).toBe('link_broken')
  })

  it('detects a deleted genesis entry', async () => {
    const ledger = await seededLedger('run-genesis')
    const entries = await ledger.storage.query({ run_id: 'run-genesis' })

    const truncatedFromStart = entries.slice(1)
    const result = verifyChain(truncatedFromStart)
    expect(result.valid).toBe(false)
    expect(result.broken_at).toBe(0)
    expect(result.reason).toBe('bad_genesis')
  })

  it('detects reordered entries', async () => {
    const ledger = await seededLedger('run-swap')
    const entries = await ledger.storage.query({ run_id: 'run-swap' })

    const swapped = [entries[0], entries[2], entries[1], entries[3]]
    const result = verifyChain(swapped)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('link_broken')
  })

  it('verifies a mixed-run array per run and reports the breakdown', async () => {
    const ledger = new AgentLedger({ agent_id: 'a', storage: { type: 'memory' } })
    const agent = ledger.wrap({
      tools: [{ name: 'noop', description: '', func: async (x: unknown) => x }],
    })
    await Promise.all([
      ledger.run(async () => {
        for (let i = 0; i < 3; i++) await agent.tools![0].func(i)
      }, 'mix-A'),
      ledger.run(async () => {
        for (let i = 0; i < 3; i++) await agent.tools![0].func(i)
      }, 'mix-B'),
    ])
    await settle()

    const all = await ledger.storage.query({})
    const clean = verifyChain(all)
    expect(clean.valid).toBe(true)
    expect(clean.runs.length).toBe(2)
    expect(clean.runs.every(r => r.valid)).toBe(true)

    // Delete one mix-B entry: mix-A must stay valid, mix-B must break.
    const bIndices = all.map((e, i) => (e.run_id === 'mix-B' ? i : -1)).filter(i => i >= 0)
    const tampered = all.filter((_, i) => i !== bIndices[1])
    const result = verifyChain(tampered)
    expect(result.valid).toBe(false)
    expect(result.runs.find(r => r.run_id === 'mix-A')?.valid).toBe(true)
    const runB = result.runs.find(r => r.run_id === 'mix-B')
    expect(runB?.valid).toBe(false)
    expect(runB?.reason).toBe('link_broken')
  })

  it('resumes the chain after a process restart (file storage)', async () => {
    const path = join(tmpdir(), `agentledger-restart-${randomUUID()}.ndjson`)
    try {
      const first = new AgentLedger({ agent_id: 'a', storage: { type: 'file', path } })
      const agent1 = first.wrap({
        tools: [{ name: 'noop', description: '', func: async (x: unknown) => x }],
      })
      await first.run(async () => {
        await agent1.tools![0].func('before-restart')
      }, 'run-restart')
      await settle()

      // Fresh instance on the same file = new process. Same run continues.
      const second = new AgentLedger({ agent_id: 'a', storage: { type: 'file', path } })
      const agent2 = second.wrap({
        tools: [{ name: 'noop', description: '', func: async (x: unknown) => x }],
      })
      await second.run(async () => {
        await agent2.tools![0].func('after-restart')
      }, 'run-restart')
      await settle()

      const result = await second.storage.verify('run-restart')
      expect(result.entry_count).toBe(2)
      expect(result.valid).toBe(true)
    } finally {
      await rm(path, { force: true })
    }
  })
})
