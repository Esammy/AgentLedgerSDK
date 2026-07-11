import { describe, it, expect } from 'vitest'
import { performance } from 'node:perf_hooks'
import { AgentLedger } from '../src/ledger/ledger'
import { createGroqCompiler } from '../src/policy/compilers/factories'
import { PolicyBlockError } from '../src/errors/errors'

const GROQ_API_KEY = process.env.GROQ_API_KEY
const GROQ_MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile'

const runLive = typeof GROQ_API_KEY === 'string' && GROQ_API_KEY.length > 0
const liveIt = runLive ? it : it.skip

describe('Groq live E2E (opt-in)', () => {
  liveIt(
    'compiles policy, enforces block/allow, and reports speed',
    async () => {
      const ledger = new AgentLedger({
        agent_id: 'groq-live-e2e',
        storage: { type: 'memory' },
        policies: [],
      })

      const compiler = createGroqCompiler(GROQ_API_KEY!, GROQ_MODEL)

      const tCompileStart = performance.now()
      await ledger.policy.addPolicyAsync(
        {
          description: 'Block any tool call where tool name is exactly danger_tool',
          action: 'block',
          severity: 'high',
        },
        compiler
      )
      const tCompileMs = performance.now() - tCompileStart

      const evalIterations = 3000
      const tEvalStart = performance.now()
      for (let i = 0; i < evalIterations; i++) {
        ledger.policy.evaluate({
          tool: 'safe_tool',
          args: [{ i }],
          agent_id: 'groq-live-e2e',
          run_id: 'run-1',
        })
      }
      const tEvalMs = performance.now() - tEvalStart
      const tEvalAvgMs = tEvalMs / evalIterations

      const agent = {
        id: 'agent-live',
        tools: [
          {
            name: 'danger_tool',
            description: 'Should be blocked by compiled policy',
            func: async () => 'danger',
          },
          {
            name: 'safe_tool',
            description: 'Should pass policy checks',
            func: async () => 'safe',
          },
        ],
      }

      const wrapped = ledger.wrap(agent)

      const tAllowedStart = performance.now()
      const allowed = await (wrapped.tools![1].func as () => Promise<string>)()
      const tToolAllowedMs = performance.now() - tAllowedStart

      await expect((wrapped.tools![0].func as () => Promise<unknown>)()).rejects.toThrow(PolicyBlockError)
      expect(allowed).toBe('safe')

      // Speed assertions are intentionally loose to avoid network/CI flakiness.
      expect(tCompileMs).toBeGreaterThan(0)
      expect(tEvalAvgMs).toBeLessThan(5)
      expect(tToolAllowedMs).toBeLessThan(50)

      console.log(
        `[groq-e2e] model=${GROQ_MODEL} compile_ms=${tCompileMs.toFixed(2)} eval_total_ms=${tEvalMs.toFixed(
          2
        )} eval_avg_ms=${tEvalAvgMs.toFixed(4)} allowed_tool_ms=${tToolAllowedMs.toFixed(2)}`
      )
    },
    120000
  )
})
