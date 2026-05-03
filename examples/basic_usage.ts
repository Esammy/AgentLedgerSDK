import { AgentLedger, POLICY_TEMPLATES } from '../src/index'

// 1. Initialize the ledger
const ledger = new AgentLedger({
  agent_id: 'billing-agent-001',
  storage: { type: 'file', path: './audit.ndjson' },
  policies: [
    POLICY_TEMPLATES.no_spend_over(100),
    POLICY_TEMPLATES.no_delete()
  ]
})

// 2. Wrap your agent (dummy agent for this example)
const myAgent = {
  id: 'finance-bot',
  tools: [
    {
      name: 'create_payment',
      description: 'Create a payment transaction',
      func: async (...args: unknown[]) => {
        const payload = args[0] as { amount: number }
        console.log(`Processing payment of $${payload.amount}...`)
        return { success: true, transaction_id: 'tx_123' }
      }
    }
  ]
}

const observedAgent = ledger.wrap(myAgent)

// 3. Run the agent
async function main() {
  console.log('--- Case 1: Allowed Action ---')
  await observedAgent.tools![0].func({ amount: 50 })

  console.log('\n--- Case 2: Blocked Action (exceeds $100) ---')
  try {
    await observedAgent.tools![0].func({ amount: 500 })
  } catch (e: any) {
    console.error(`Blocked: ${e.message}`)
  }
}

main()
