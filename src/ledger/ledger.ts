import { EventEmitter } from 'events'
import { createHash, randomUUID } from 'crypto'
import { AsyncLocalStorage } from 'async_hooks'
import type {
  LedgerEntry,
  AgentLike,
  ToolCallPayload,
  PolicyBlockPayload,
} from './types'
import type { PolicyInput } from '../policy/types'
import { PolicyEngine } from '../policy/engine'
import type { StorageConfig } from '../storage/storage'
import { LedgerStorage } from '../storage/storage'
import { Interceptor } from '../interceptor/interceptor'

export type {
  LedgerEntry,
  ToolCallPayload,
  LLMDecisionPayload,
  PolicyBlockPayload,
  EntryPayload,
  AgentLike,
  Tool,
  LLMInterface,
} from './types'

export const ledgerContext = new AsyncLocalStorage<{ run_id: string }>()

export interface LedgerConfig {
  agent_id: string
  storage: StorageConfig
  policies?: PolicyInput[]
  risk_threshold_alert?: number
  risk_threshold_block?: number
  summarizer?: (entry: Omit<LedgerEntry, 'id' | 'prev_id' | 'human_summary'>) => Promise<string>
}

export type LedgerEvent = LedgerEntry | { run_id?: string; ts: number }

export class AgentLedger extends EventEmitter {
  readonly agentId: string
  readonly storage: LedgerStorage
  readonly policy: PolicyEngine
  private interceptor: Interceptor
  private chainHead: string = '0'.repeat(64)
  private config: LedgerConfig
  private recordQueue: Promise<void> = Promise.resolve()

  constructor(config: LedgerConfig) {
    super()
    this.config = config
    this.agentId = config.agent_id
    this.storage = new LedgerStorage(config.storage)
    this.policy = new PolicyEngine(config.policies ?? [])
    this.interceptor = new Interceptor(this)
  }

  wrap<T extends AgentLike>(agent: T): T {
    if (!agent.id) agent.id = `${this.agentId}-${randomUUID().slice(0, 8)}`
    return this.interceptor.patch(agent)
  }

  run<R>(cb: () => R, run_id?: string): R {
    const id = run_id ?? randomUUID()
    return ledgerContext.run({ run_id: id }, cb)
  }

  async killSwitch(run_id?: string): Promise<void> {
    await this.interceptor.halt(run_id)
    this.emit('kill', { run_id: run_id ?? '__all__', ts: Date.now() })
  }

  async approveGate(token: string, approved_by: string): Promise<void> {
    this.interceptor.resolveGate(token, { approved: true, approved_by })
  }

  async denyGate(token: string, denied_by: string): Promise<void> {
    this.interceptor.resolveGate(token, { approved: false, denied_by })
  }

  async record(raw: Omit<LedgerEntry, 'id' | 'prev_id' | 'human_summary'>): Promise<LedgerEntry> {
    const human_summary = this.config.summarizer
      ? await this.config.summarizer(raw)
      : this.defaultSummary(raw)

    return new Promise((resolve, reject) => {
      this.recordQueue = this.recordQueue.then(async () => {
        try {
          const prev_id = this.chainHead
          const id = createHash('sha256').update(prev_id + JSON.stringify(raw.payload)).digest('hex')
          this.chainHead = id

          const entry: LedgerEntry = {
            ...raw,
            id,
            prev_id,
            human_summary,
          }

          await this.storage.append(entry)
          this.emit('entry', entry)
          resolve(entry)
        } catch (err) {
          reject(err)
        }
      })
    })
  }

  private defaultSummary(entry: Omit<LedgerEntry, 'id' | 'prev_id' | 'human_summary'>): string {
    if (entry.type === 'tool_call') {
      const p = entry.payload as ToolCallPayload
      return `Agent called tool "${p.tool_name}" (${p.duration_ms}ms, risk=${entry.risk_score})`
    }
    if (entry.type === 'policy_block') {
      const p = entry.payload as PolicyBlockPayload
      return `BLOCKED: "${p.blocked_action}" by policy "${p.policy_text}"`
    }
    if (entry.type === 'approval_gate') {
      const p = entry.payload as PolicyBlockPayload
      return `PENDING APPROVAL: "${p.blocked_action}" — awaiting human review`
    }
    return `Agent LLM decision recorded`
  }
}
