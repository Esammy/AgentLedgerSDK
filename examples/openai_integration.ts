/**
 * AgentLedger + Raw OpenAI (Function Calling) Integration Example
 *
 * Shows how to govern an OpenAI function-calling agent with AgentLedger.
 * AgentLedger intercepts your tool dispatch functions — the code you run
 * when OpenAI returns a `tool_calls` array in the assistant message.
 *
 * Run:  npx tsx examples/openai_integration.ts
 * Note: This example runs offline. No OPENAI_API_KEY required.
 *       In production, call governed tools inside your tool_calls dispatch loop.
 */

import { AgentLedger, POLICY_TEMPLATES, PolicyBlockError, KillSwitchError } from '../src/index'

// ─── Your tool implementations ────────────────────────────────────────────────
// These are the functions you'd normally call when OpenAI returns tool_calls.

const toolImplementations: Record<string, (...args: unknown[]) => Promise<unknown>> = {
  search_web: async (...args: unknown[]) => {
    const input = args[0] as { query: string }
    console.log(`  [Tool] Searching web: "${input.query}"`)
    return { results: ['Result A', 'Result B'], count: 2 }
  },

  create_payment: async (...args: unknown[]) => {
    const input = args[0] as { amount: number; currency: string; recipient: string }
    console.log(`  [Tool] Creating payment: ${input.currency} ${input.amount} → ${input.recipient}`)
    return { payment_id: 'pay_xyz789', status: 'queued' }
  },

  write_file: async (...args: unknown[]) => {
    const input = args[0] as { path: string; content: string }
    console.log(`  [Tool] Writing file: ${input.path}`)
    return { written: true, bytes: input.content.length }
  },

  // named 'deleteRecord' so the no_delete() template matches it
  deleteRecord: async (...args: unknown[]) => {
    const input = args[0] as { table: string; id: string }
    console.log(`  [Tool] Deleting ${input.table}/${input.id}`)
    return { deleted: true }
  },
}

// ─── AgentLedger setup ────────────────────────────────────────────────────────

const ledger = new AgentLedger({
  agent_id: 'openai-function-agent',
  storage: { type: 'memory' },
  policies: [
    POLICY_TEMPLATES.no_spend_over(500),
    POLICY_TEMPLATES.no_delete(),
  ],
})

const agent = ledger.wrap({
  id: 'openai-function-agent',
  tools: Object.entries(toolImplementations).map(([name, func]) => ({
    name,
    description: `Implementation for ${name}`,
    func,
  })),
})

// ─── Simulate OpenAI tool_calls dispatch loop ─────────────────────────────────
// In production this would be inside your `while (response.finish_reason === 'tool_calls')` loop.

async function dispatchToolCall(tool_call: { name: string; arguments: unknown }) {
  const tool = agent.tools!.find(t => t.name === tool_call.name)
  if (!tool) return { error: `Unknown tool: ${tool_call.name}` }

  console.log(`\n→ OpenAI requested tool: ${tool_call.name}`)
  try {
    const result = await (tool.func as (...a: unknown[]) => Promise<unknown>)(tool_call.arguments)
    console.log(`  ✅ Result:`, JSON.stringify(result))
    return result
  } catch (err) {
    if (err instanceof PolicyBlockError) {
      console.log(`  🛑 BLOCKED by policy: ${err.message}`)
      // Return a structured error so OpenAI can reason about it
      return { error: 'governance_block', reason: err.message }
    }
    if (err instanceof KillSwitchError) {
      console.log(`  ☠️  KILL SWITCH: agent halted`)
      return { error: 'kill_switch_active' }
    }
    throw err
  }
}

// ─── Demo ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== AgentLedger + OpenAI Function Calling Demo ===')
  console.log('(Simulating OpenAI tool_calls without a live API call)\n')

  // Wrap calls in ledger.run() for request-scoped isolation in a server context
  await ledger.run(async () => {
    // Simulated sequence of tool_calls OpenAI might return:
    const calls = [
      { name: 'search_web',    arguments: { query: 'Q3 financial report template' } },
      { name: 'create_payment', arguments: { amount: 299, currency: 'USD', recipient: 'supplier-a' } },
      { name: 'create_payment', arguments: { amount: 750, currency: 'USD', recipient: 'supplier-b' } }, // blocked by no_spend_over(500)
      { name: 'deleteRecord',   arguments: { table: 'users', id: 'usr_stale_001' } }, // blocked by no_delete()
      { name: 'write_file',     arguments: { path: './report.md', content: '# Q3 Report\n...' } },
    ]

    for (const call of calls) {
      await dispatchToolCall(call)
    }
  }, 'openai-session-001')

  // ─── Kill switch demo ────────────────────────────────────────────────────────
  console.log('\n--- Kill Switch Demo ---')
  await ledger.run(async () => {
    console.log('\n→ Starting a new run, then triggering kill switch mid-flight...')
    // killSwitch() with no arguments = GLOBAL halt — stops ALL future runs.
    // killSwitch('openai-session-002') would halt only this specific run.
    // Both are supported; use run-scoped for per-request control in servers.
    setTimeout(() => ledger.killSwitch(), 50)
    await new Promise(r => setTimeout(r, 100))
    await dispatchToolCall({ name: 'write_file', arguments: { path: './oops.txt', content: 'should not write' } })
  }, 'openai-session-002')

  // ─── Audit summary ───────────────────────────────────────────────────────────
  console.log('\n--- Audit Chain Summary ---')
  const entries = await ledger.storage.query({})
  const byType = entries.reduce((acc, e) => {
    acc[e.type] = (acc[e.type] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)
  console.log(`  Total entries: ${entries.length}`)
  for (const [type, count] of Object.entries(byType)) {
    console.log(`    ${type}: ${count}`)
  }
  const first = entries[0]
  if (first) {
    const { valid } = await ledger.storage.verify(first.run_id)
    console.log(`  Chain integrity: ${valid ? '✅ VALID' : '❌ BROKEN'}`)
  }
}

main().catch(console.error)
