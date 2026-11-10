import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
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
import { computeEntryId, GENESIS_PREV_ID, normalizeForLedger } from './hash'

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
  // Per-run chain heads so concurrent runs each get an internally-consistent chain.
  private chainHeads: Map<string, string> = new Map()
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

  async record(input: Omit<LedgerEntry, 'id' | 'prev_id' | 'human_summary'>): Promise<LedgerEntry> {
    // Snapshot + normalize to its JSON form: the hash then matches what storage
    // round-trips, and later mutation of caller-owned objects can't alter it.
    const raw = normalizeForLedger(input)
    const human_summary = this.config.summarizer
      ? await this.config.summarizer(raw)
      : this.defaultSummary(raw)

    return new Promise((resolve, reject) => {
      this.recordQueue = this.recordQueue.then(async () => {
        try {
          let prev_id = this.chainHeads.get(raw.run_id)
          if (prev_id === undefined) {
            // First record for this run in THIS process. If storage already
            // holds entries for the run (process restart mid-run), resume the
            // chain from the last persisted entry instead of re-anchoring at
            // genesis — otherwise verifyChain would flag the run as broken.
            prev_id = await this.recoverChainHead(raw.run_id)
          }
          const withPrev = { ...raw, prev_id }
          const id = computeEntryId(withPrev)

          const entry: LedgerEntry = {
            ...withPrev,
            id,
            human_summary,
          }

          await this.storage.append(entry)
          // Advance the head only once the entry is durably stored; otherwise a
          // failed write would leave a permanent gap in the chain.
          this.chainHeads.set(raw.run_id, id)
          this.emit('entry', entry)
          resolve(entry)
        } catch (err) {
          reject(err)
        }
      })
    })
  }

  private async recoverChainHead(run_id: string): Promise<string> {
    try {
      const existing = await this.storage.query({ run_id })
      if (existing.length > 0) return existing[existing.length - 1].id
    } catch {
      // Storage unreadable (e.g. cloud adapter offline) — start a fresh
      // chain rather than fail the record.
    }
    return GENESIS_PREV_ID
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
