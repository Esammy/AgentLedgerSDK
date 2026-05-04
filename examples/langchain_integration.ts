/**
 * AgentLedger + LangChain-Compatible Tool Shape Example
 *
 * AgentLedger wraps any object whose tools satisfy { name, description, func }.
 * This is the exact shape LangChain's DynamicStructuredTool / StructuredTool
 * uses, so you can drop AgentLedger in front of any LangChain agent executor
 * without installing @langchain/core for this file itself.
 *
 * For a real LangChain project you would do:
 *   const tool = new DynamicStructuredTool({ name, description, schema, func })
 *   const governed = ledger.wrap({ id: 'my-agent', tools: [tool, ...] })
 *   // then pass governed.tools to your LangChain executor as normal
 *
 * Run (no API keys needed):
 *   npx tsx examples/langchain_integration.ts
 */

import { AgentLedger, POLICY_TEMPLATES, PolicyBlockError, ApprovalDeniedError } from '../src/index'

// ─── Tools (LangChain-compatible shape) ──────────────────────────────────────
// Tool names MUST match what policy templates check.
// no_delete() matches: delete_file | deleteRecord | drop_table | fs.rm | unlink | rm_rf
// no_spend_over(n) matches: charge_card | create_payment | purchase | stripe_charge
// external_email_gate matches via heuristic: tools whose name includes send_email / sendEmail

const tools = [
  {
    name: 'create_payment',
    description: 'Process a payment transaction',
    func: async (...args: unknown[]) => {
      const input = args[0] as { amount: number; recipient: string }
      console.log(`  [Tool] Processing $${input.amount} → ${input.recipient}`)
      return { success: true, tx_id: `tx_${Math.random().toString(36).slice(2, 8)}` }
    },
  },
  {
    name: 'send_email',
    description: 'Send an email to a recipient',
    func: async (...args: unknown[]) => {
      const input = args[0] as { to: string; subject: string }
      console.log(`  [Tool] Sending email → ${input.to}: "${input.subject}"`)
      return { sent: true }
    },
  },
  {
    // 'deleteRecord' is in the no_delete() template match list — 'delete_record' is NOT
    name: 'deleteRecord',
    description: 'Delete a database record',
    func: async (...args: unknown[]) => {
      const input = args[0] as { table: string; id: string }
      console.log(`  [Tool] Deleting ${input.table}/${input.id}`)
      return { deleted: true }
    },
  },
]

// ─── AgentLedger setup ────────────────────────────────────────────────────────

const ledger = new AgentLedger({
  agent_id: 'langchain-finance-agent',
  storage: { type: 'memory' },
  policies: [
    POLICY_TEMPLATES.no_spend_over(500),             // Blocks create_payment when amount > $500
    POLICY_TEMPLATES.no_delete(),                    // Blocks deleteRecord, delete_file, etc.
    POLICY_TEMPLATES.external_email_gate('corp.com'), // Approval gate for external emails
  ],
})

// Wrap — returns the same agent object with tools intercepted
const agent = ledger.wrap({ id: 'langchain-finance-agent', tools })

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function callTool(name: string, input: unknown) {
  const tool = agent.tools!.find(t => t.name === name)
  if (!tool) throw new Error(`Tool ${name} not found`)
  console.log(`\n→ Agent calling: ${name}`)
  try {
    const result = await (tool.func as (...a: unknown[]) => Promise<unknown>)(input)
    console.log(`  ✅ Result:`, result)
  } catch (err) {
    if (err instanceof PolicyBlockError) {
      console.log(`  🛑 BLOCKED by policy: ${err.message}`)
    } else if (err instanceof ApprovalDeniedError) {
      console.log(`  ❌ APPROVAL DENIED — a reviewer denied the gate`)
    } else {
      throw err
    }
  }
}

// ─── Demo ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== AgentLedger + LangChain-Compatible Tool Shape Demo ===\n')

  // Wrap entire session in ledger.run so all tool calls share one run_id.
  // In a LangChain server (Fastify/Express), call this once per request:
  //   app.post('/chat', (req, res) => ledger.run(() => handleRequest(req, res), req.id))
  await ledger.run(async () => {
    // Case 1: Allowed — small payment within the $500 limit
    await callTool('create_payment', { amount: 200, recipient: 'vendor-a' })

    // Case 2: Blocked — exceeds $500 spend limit
    await callTool('create_payment', { amount: 750, recipient: 'vendor-b' })

    // Case 3: Blocked — deleteRecord is in the no_delete() match list
    await callTool('deleteRecord', { table: 'users', id: 'usr_123' })

    // Case 4: Allowed — internal email (to: ends with @corp.com → gate does not fire)
    await callTool('send_email', { to: 'alice@corp.com', subject: 'Weekly report' })

    // Case 5: external_email_gate fires — email to outside org triggers approve_gate
    // In production you'd call ledger.approveGate(token, 'reviewer') from a dashboard
    // or Slack webhook. Here the gate will auto-timeout after 30 min; for the demo
    // we show the timeout path.
    console.log('\n  [Note] external_email_gate fires on the next call.')
    console.log('  In production: await ledger.approveGate(token, approver)')
    console.log('  In this demo: we catch the timeout immediately.\n')
    await callTool('send_email', { to: 'partner@external.com', subject: 'Proposal' })

  }, 'demo-session-001')

  // ─── Verify the audit chain for the run ─────────────────────────────────────
  // We verify the specific run_id we just executed, not an arbitrary first entry.
  console.log('\n--- Audit Chain Verification ---')
  const { valid, entry_count, broken_at } = await ledger.storage.verify('demo-session-001')
  console.log(`  Entries in run:   ${entry_count}`)
  console.log(`  Chain integrity:  ${valid ? '✅ VALID' : `❌ BROKEN at ${broken_at}`}`)

  console.log('\n✅ Done. For a production setup, switch storage to:')
  console.log("  storage: { type: 'file', path: './audit.ndjson' }")
}

main().catch(console.error)
