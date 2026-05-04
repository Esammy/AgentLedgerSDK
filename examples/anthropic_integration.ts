/**
 * AgentLedger + Anthropic (Claude Tool Use) Integration Example
 *
 * Shows how to govern a Claude tool-use agent with AgentLedger.
 * AgentLedger wraps your tool handler functions — the same functions you'd
 * invoke when Claude returns a tool_use block. No Anthropic SDK modification needed.
 *
 * Run:  npx tsx examples/anthropic_integration.ts
 * Note: This example runs offline. No ANTHROPIC_API_KEY required.
 *       In production, call your governed tools from inside the Claude response loop.
 */

import { AgentLedger, POLICY_TEMPLATES, PolicyBlockError } from '../src/index'

// ─── Your actual tool implementations ────────────────────────────────────────
// These are the functions you'd normally call when Claude returns a tool_use block.
// In a real setup you'd also define `tools` for the Anthropic messages API.

const toolImplementations = {
  query_database: async (...args: unknown[]) => {
    const input = args[0] as { query: string; limit?: number }
    console.log(`  [Tool] Querying DB: "${input.query}" (limit=${input.limit ?? 100})`)
    return { rows: [{ id: 1, name: 'Sample record' }], count: 1 }
  },

  // named 'deleteRecord' so the no_delete() template matches it
  deleteRecord: async (...args: unknown[]) => {
    const input = args[0] as { table: string; id: string }
    console.log(`  [Tool] Deleting ${input.table}#${input.id}`)
    return { deleted: true }
  },

  // named 'create_payment' so the no_spend_over() template matches it
  create_payment: async (...args: unknown[]) => {
    const input = args[0] as { amount: number; client_email: string }
    console.log(`  [Tool] Creating payment $${input.amount} → ${input.client_email}`)
    return { invoice_id: 'inv_abc123', sent: true }
  },
}

// ─── AgentLedger setup ────────────────────────────────────────────────────────

const ledger = new AgentLedger({
  agent_id: 'claude-tool-agent',
  storage: { type: 'memory' },
  policies: [
    POLICY_TEMPLATES.no_delete(),
    POLICY_TEMPLATES.no_spend_over(1000),
  ],
})

// Wrap the tools as an AgentLike object
const agent = ledger.wrap({
  id: 'claude-tool-agent',
  tools: Object.entries(toolImplementations).map(([name, func]) => ({
    name,
    description: `Implementation for ${name}`,
    func,
  })),
})

// ─── Helper: call a governed tool by name (mirrors what you'd do in a Claude loop) ──

async function callGovernedTool(name: string, input: unknown) {
  const tool = agent.tools!.find(t => t.name === name)
  if (!tool) throw new Error(`Unknown tool: ${name}`)
  console.log(`\n→ Claude requested: ${name}`)
  try {
    const result = await (tool.func as (...a: unknown[]) => Promise<unknown>)(input)
    console.log(`  ✅ Result:`, JSON.stringify(result))
    return result
  } catch (err) {
    if (err instanceof PolicyBlockError) {
      console.log(`  🛑 BLOCKED: ${err.message}`)
      // Return the error to Claude as a tool_result content block
      return { error: 'Action blocked by governance policy', policy: err.message }
    }
    throw err
  }
}

// ─── Simulate a Claude tool-use conversation loop ─────────────────────────────

async function main() {
  console.log('\n=== AgentLedger + Anthropic Claude Integration Demo ===')
  console.log('(Simulating Claude tool_use blocks without a live API call)\n')

  // In production, wrap your entire Claude request handler in ledger.run():
  //   await ledger.run(() => handleClaudeLoop(messages), request.id)
  // This isolates all tool calls for one request under a shared run_id.

  // These are the tool calls Claude would return in a real conversation:
  const claudeToolCalls = [
    { name: 'query_database', input: { query: 'SELECT * FROM invoices WHERE status=pending', limit: 50 } },
    { name: 'create_payment',   input: { amount: 850, client_email: 'client@example.com' } },
    { name: 'deleteRecord',  input: { table: 'invoices', id: 'inv_old_001' } }, // will be blocked by no_delete()
    { name: 'create_payment',   input: { amount: 1500, client_email: 'big@client.com' } }, // will be blocked by no_spend_over(1000)
  ]

  for (const call of claudeToolCalls) {
    await callGovernedTool(call.name, call.input)
  }

  // ─── Audit verification ──────────────────────────────────────────────────────
  console.log('\n--- Audit Summary ---')
  const entries = await ledger.storage.query({})
  console.log(`  Total events recorded: ${entries.length}`)
  for (const e of entries) {
    const icon = e.type === 'policy_block' ? '🛑' : '✅'
    console.log(`  ${icon} [${e.type}] ${e.human_summary}`)
  }
}

main().catch(console.error)
