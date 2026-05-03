import { AgentLedger, ledgerContext } from '../src/index'
import { randomUUID } from 'crypto'

const ledger = new AgentLedger({
  agent_id: 'multi-user-agent',
  storage: { type: 'memory' }
})

const agent = ledger.wrap({
  tools: [{
    name: 'data_tool',
    description: 'Fetch some data',
    func: async (...args: unknown[]) => {
      const id = args[0] as string
      return `Data for ${id}`
    }
  }]
})

async function handleUserRequest(userId: string) {
  // Use ledger.run() to isolate the audit trail for this specific user request
  return ledger.run(async () => {
    const runId = ledgerContext.getStore()?.run_id
    console.log(`[User: ${userId}] Starting run: ${runId}`)
    
    await agent.tools![0].func(userId)
    
    console.log(`[User: ${userId}] Finished run: ${runId}`)
  }, `request-${userId}-${randomUUID().slice(0, 4)}`)
}

async function main() {
  // Simulate concurrent user requests
  await Promise.all([
    handleUserRequest('Alice'),
    handleUserRequest('Bob'),
    handleUserRequest('Charlie')
  ])
  
  // Wait a moment for the fire-and-forget logging queue to settle
  await new Promise(r => setTimeout(r, 50))
  
  const entries = await ledger.storage.query({})
  console.log(`\nRecorded ${entries.length} entries with isolated run_ids:`)
  entries.forEach(e => console.log(` - ${e.run_id}: ${e.human_summary}`))
}

main()
