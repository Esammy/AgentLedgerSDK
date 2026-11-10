import { randomUUID } from 'crypto'
import type { AgentLedger } from '../ledger/ledger'
import { ledgerContext } from '../ledger/ledger'
import type { AgentLike, Tool, ToolCallPayload } from '../ledger/types'
import { RiskScorer } from '../risk/risk'
import { PolicyBlockError, ApprovalDeniedError, KillSwitchError } from '../errors/errors'

interface GateResolution {
  approved: boolean
  approved_by?: string
  denied_by?: string
}

const WRAPPED_MARKER = '__agentledger_wrapped'

/** JSON preview that never throws (circular refs, BigInt, ...). */
function preview(value: unknown, max: number): string {
  try {
    return (JSON.stringify(value) ?? 'undefined').slice(0, max)
  } catch {
    return '[unserializable]'
  }
}

type WrappedFunc = ((...args: unknown[]) => Promise<unknown>) & {
  [WRAPPED_MARKER]?: true
}

export class Interceptor {
  private halted = new Set<string>()
  private scorer = new RiskScorer()
  private pendingGates = new Map<string, { runId: string; resolve: (resolution: GateResolution) => void }>()

  constructor(private ledger: AgentLedger) {}

  patch<T extends AgentLike>(agent: T): T {
    if (agent.tools) {
      agent.tools = agent.tools.map(tool => this.wrapTool(tool, agent.id!))
    }
    if (agent.llm?.invoke) {
      const existing = agent.llm.invoke as WrappedFunc
      if (!existing[WRAPPED_MARKER]) {
        agent.llm.invoke = this.wrapLLMCall(agent.llm.invoke.bind(agent.llm), agent.id!)
      }
    }
    return agent
  }

  private wrapTool(tool: Tool, agentId: string): Tool {
    // Idempotency: re-wrapping a tool that's already governed is a no-op,
    // so calling ledger.wrap(agent) twice doesn't double-record or
    // double-evaluate policies.
    const existing = tool.func as WrappedFunc
    if (existing[WRAPPED_MARKER]) return tool

    const originalFunc = tool.func
    const interceptor = this

    const wrapped: WrappedFunc = async (...args: unknown[]): Promise<unknown> => {
      const runId = ledgerContext.getStore()?.run_id ?? randomUUID()

      if (interceptor.halted.has('__all__') || interceptor.halted.has(runId)) {
        throw new KillSwitchError(runId)
      }

      const decision = interceptor.ledger.policy.evaluate({
        tool: tool.name,
        args,
        agent_id: agentId,
        run_id: runId,
      })

      if (decision.action === 'block') {
        try {
          await interceptor.ledger.record({
            agent_id: agentId,
            run_id: runId,
            ts: Date.now(),
            type: 'policy_block',
            risk_score: 100,
            payload: {
              policy_id: decision.policy_id!,
              policy_text: decision.reason,
              blocked_action: `${tool.name}(${preview(args, 200)})`,
              escalated_to: decision.escalate_to,
            },
          })
        } catch (err) {
          interceptor.ledger.emit('storage_error', err)
        }
        if (decision.escalate_to?.length) {
          await interceptor.escalate(decision, tool.name, args)
        }
        throw new PolicyBlockError(decision.reason)
      }

      if (decision.action === 'approve_gate') {
        const token = randomUUID()
        try {
          await interceptor.ledger.record({
            agent_id: agentId,
            run_id: runId,
            ts: Date.now(),
            type: 'approval_gate',
            risk_score: 75,
            payload: {
              policy_id: decision.policy_id!,
              policy_text: decision.reason,
              blocked_action: `${tool.name}(${preview(args, 200)})`,
              escalated_to: decision.escalate_to,
              override_token: token,
            },
          })
        } catch (err) {
          interceptor.ledger.emit('storage_error', err)
        }
        const resolution = await interceptor.waitForApproval(token, decision, runId)
        // Audit the outcome so the ledger shows who approved/denied and why.
        const outcome = resolution.approved
          ? 'approved'
          : resolution.denied_by === 'timeout'
            ? 'timeout'
            : resolution.denied_by === 'kill_switch'
              ? 'kill_switch'
              : 'denied'
        try {
          await interceptor.ledger.record({
            agent_id: agentId,
            run_id: runId,
            ts: Date.now(),
            type: 'approval_gate',
            risk_score: resolution.approved ? 25 : 50,
            payload: {
              policy_id: decision.policy_id!,
              policy_text: decision.reason,
              blocked_action: `${tool.name}(${preview(args, 200)})`,
              override_token: token,
              resolution: outcome,
              resolved_by: resolution.approved ? resolution.approved_by : resolution.denied_by,
            },
          })
        } catch (err) {
          interceptor.ledger.emit('storage_error', err)
        }
        if (!resolution.approved) {
          throw new ApprovalDeniedError(`Gate denied by ${resolution.denied_by}`)
        }
      }

      // `alert` and `log_only` do not block the call. We emit an `alert`
      // event so dashboards can surface them, and let the tool run as
      // normal — the regular tool_call entry below is the audit record.
      if (decision.action === 'alert' || decision.action === 'log_only') {
        interceptor.ledger.emit('alert', {
          policy_id: decision.policy_id,
          reason: decision.reason,
          tool: tool.name,
          args_preview: preview(args, 300),
          escalate_to: decision.escalate_to,
          run_id: runId,
          agent_id: agentId,
          ts: Date.now(),
        })
        if (decision.escalate_to?.length) {
          await interceptor.escalate(decision, tool.name, args)
        }
      }

      const start = performance.now()
      let output: unknown
      let errorMsg: string | undefined

      try {
        output = await originalFunc(...args)
      } catch (err) {
        errorMsg = err instanceof Error ? err.message : String(err)
        throw err
      } finally {
        let riskScore = 0
        let dataClassifications: string[] = []
        try {
          riskScore = interceptor.scorer.score(tool.name, args, output)
          dataClassifications = interceptor.scorer.classifyData(args, output)
        } catch {
          // Ignore scorer errors to prevent crashing the finally block
        }

        const payload: ToolCallPayload = {
          tool_name: tool.name,
          tool_input: args,
          tool_output: output,
          error: errorMsg,
          duration_ms: Math.round(performance.now() - start),
          data_classifications: dataClassifications,
        }
        interceptor.ledger
          .record({
            agent_id: agentId,
            run_id: runId,
            ts: Date.now(),
            type: 'tool_call',
            risk_score: riskScore,
            payload,
          })
          .catch(err => interceptor.ledger.emit('storage_error', err))
      }

      return output
    }

    Object.defineProperty(wrapped, WRAPPED_MARKER, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    })

    return { ...tool, func: wrapped }
  }

  private wrapLLMCall(
    originalInvoke: (...args: unknown[]) => Promise<unknown>,
    agentId: string
  ): WrappedFunc {
    const interceptor = this
    const wrapped: WrappedFunc = async (...args: unknown[]): Promise<unknown> => {
      const llmRunId = ledgerContext.getStore()?.run_id ?? randomUUID()
      if (interceptor.halted.has('__all__') || interceptor.halted.has(llmRunId)) {
        throw new KillSwitchError(llmRunId)
      }
      const start = Date.now()
      const result = await originalInvoke(...args)
      interceptor.ledger
        .record({
          agent_id: agentId,
          run_id: llmRunId,
          ts: start,
          type: 'llm_decision',
          risk_score: 10,
          payload: {
            model: (result as { model?: string })?.model ?? 'unknown',
            prompt_tokens: (result as { usage?: { input_tokens?: number } })?.usage?.input_tokens ?? 0,
            completion_tokens:
              (result as { usage?: { output_tokens?: number } })?.usage?.output_tokens ?? 0,
            reasoning_summary: '',
            chosen_action: '',
            alternatives_considered: [],
          },
        })
        .catch(() => {})
      return result
    }
    Object.defineProperty(wrapped, WRAPPED_MARKER, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    })
    return wrapped
  }

  private async waitForApproval(
    token: string,
    decision: ReturnType<AgentLedger['policy']['evaluate']>,
    runId: string
  ): Promise<GateResolution> {
    if (decision.escalate_to?.length) {
      await this.escalate(decision, 'approval_gate', [], token)
    }
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        if (this.pendingGates.has(token)) {
          this.pendingGates.delete(token)
          resolve({ approved: false, denied_by: 'timeout' })
        }
      }, 30 * 60 * 1000)
      // Don't keep the event loop alive for half an hour just to wait on
      // a gate — let the process exit naturally if everything else is done.
      if (typeof timer.unref === 'function') timer.unref()

      this.pendingGates.set(token, {
        runId,
        resolve: resolution => {
          clearTimeout(timer)
          resolve(resolution)
        },
      })
    })
  }

  /** Returns false when the token is unknown, expired or already resolved. */
  resolveGate(token: string, resolution: GateResolution): boolean {
    const pending = this.pendingGates.get(token)
    if (!pending) return false
    this.pendingGates.delete(token)
    pending.resolve(resolution)
    return true
  }

  private async escalate(
    decision: ReturnType<AgentLedger['policy']['evaluate']>,
    toolName: string,
    args: unknown[],
    approvalToken?: string
  ): Promise<void> {
    this.ledger.emit('escalation', {
      policy_id: decision.policy_id,
      reason: decision.reason,
      tool: toolName,
      args_preview: preview(args, 300),
      escalate_to: decision.escalate_to,
      approval_token: approvalToken,
      ts: Date.now(),
    })
  }

  async halt(run_id?: string): Promise<void> {
    this.halted.add(run_id ?? '__all__')
    // Release approval gates the halted run(s) are blocked on, instead of
    // leaving them hanging for the full 30-minute timeout.
    for (const [token, pending] of [...this.pendingGates]) {
      if (!run_id || pending.runId === run_id) {
        this.resolveGate(token, { approved: false, denied_by: 'kill_switch' })
      }
    }
  }
}
