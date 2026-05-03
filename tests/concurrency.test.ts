import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import { AgentLedger } from '../src/ledger/ledger'

describe('AgentLedger Concurrency Fix', () => {
  it('should maintain chain integrity under heavy concurrent load', async () => {
    const ledger = new AgentLedger({
      agent_id: 'test-agent',
      storage: { type: 'memory' },
      // Use an async summarizer with random delays to induce race conditions
      summarizer: async () => {
        await new Promise(r => setTimeout(r, Math.random() * 50))
        return 'Test summary'
      }
    })

    const agent = {
      id: 'agent-1',
      tools: [
        {
          name: 'slow_tool',
          description: 'A tool that is slow',
          func: async (...args: unknown[]) => {
            const x = args[0] as number
            await new Promise(r => setTimeout(r, Math.random() * 10))
            return x * 2
          }
        }
      ]
    }

    const wrapped = ledger.wrap(agent)

    // Trigger 50 tool calls simultaneously without `await` inside the loop
    const promises = Array.from({ length: 50 }).map((_, i) => wrapped.tools![0].func(i))
    
    // Wait for all tool calls and their subsequent async logging to complete
    await Promise.all(promises)
    
    // Slight delay to ensure all async fire-and-forget logging settles
    await new Promise(r => setTimeout(r, 100))

    const allEntries = await ledger.storage.query({})
    expect(allEntries.length).toBe(50)

    // Verify chain manually across all entries
    let valid = true
    for (let i = 1; i < allEntries.length; i++) {
      const expected = createHash('sha256')
        .update(allEntries[i - 1].id + JSON.stringify(allEntries[i].payload))
        .digest('hex')
      if (expected !== allEntries[i].id) {
        valid = false
        break
      }
    }

    expect(valid).toBe(true)
  })

  it('should isolate run_ids correctly using ledgerContext', async () => {
    const ledger = new AgentLedger({
      agent_id: 'test-agent',
      storage: { type: 'memory' },
    })

    const agent = {
      tools: [
        {
          name: 'fast_tool',
          description: 'A tool that is fast',
          func: async () => 'done'
        }
      ]
    }

    const wrapped = ledger.wrap(agent)

    await Promise.all([
      ledger.run(async () => {
        await wrapped.tools![0].func()
      }, 'run-A'),
      ledger.run(async () => {
        await wrapped.tools![0].func()
      }, 'run-B')
    ])

    // Wait for fire-and-forget logging to settle
    await new Promise(r => setTimeout(r, 50))

    const entries = await ledger.storage.query({})
    const runs = new Set(entries.map(e => e.run_id))
    expect(runs.has('run-A')).toBe(true)
    expect(runs.has('run-B')).toBe(true)
    expect(entries.length).toBe(2)
  })
})
