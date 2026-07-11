/**
 * Natural-language policy compilation.
 *
 * The policy below is written in plain English and compiled ONCE at startup
 * into a deterministic rule AST (via the Anthropic API here — Gemini, OpenAI,
 * Groq, Mistral, and any OpenAI-compatible host work the same way through
 * their factory helpers). No LLM ever runs on the per-tool-call path.
 *
 * Run: ANTHROPIC_API_KEY=sk-... npx tsx examples/policy_compilation.ts
 */
import { AgentLedger, ClaudeCompiler } from '../src/index'

async function main() {
  const ledger = new AgentLedger({
    agent_id: 'policy-test-agent',
    storage: { type: 'memory' },
  })

  const compiler = new ClaudeCompiler({
    apiKey: process.env.ANTHROPIC_API_KEY ?? 'your-key-here',
  })

  console.log('Compiling natural language policy...')

  await ledger.policy.addPolicyAsync(
    {
      description: 'Never allow sending emails to addresses ending in @competitor.com',
      action: 'block',
      severity: 'high',
    },
    compiler
  )

  console.log('Policy compiled and added to engine.')

  const agent = ledger.wrap({
    tools: [
      {
        name: 'send_email',
        description: 'Send an email',
        func: async (...args: unknown[]) => {
          const to = args[0] as string
          return `Email sent to ${to}`
        },
      },
    ],
  })

  console.log('\n--- Testing Policy ---')
  try {
    await agent.tools![0].func('info@competitor.com')
    console.log('Unexpected: the call was not blocked.')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.log(`Success: Policy blocked the action. Error: ${msg}`)
  }
}

main()
