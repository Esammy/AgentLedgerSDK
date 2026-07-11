import { appendFile, readFile } from 'fs/promises'
import type { LedgerEntry } from '../ledger/types'
import { computeEntryId, GENESIS_PREV_ID } from '../ledger/hash'

export interface EntryFilter {
  run_id?: string
  agent_id?: string
  type?: LedgerEntry['type']
  since?: number
  until?: number
  min_risk?: number
}

export type ChainBreakReason = 'hash_mismatch' | 'link_broken' | 'bad_genesis'

export interface RunChainVerification {
  run_id: string
  valid: boolean
  /** Index of the first bad entry within this run's sequence. */
  broken_at: number | null
  reason?: ChainBreakReason
  entry_count: number
}

export interface ChainVerification {
  valid: boolean
  /** Index of the first bad entry within the array passed to verifyChain. */
  broken_at: number | null
  reason?: ChainBreakReason
  entry_count: number
  verified_at: number
  /** Per-run breakdown — entries are chained per run_id, so mixed-run arrays verify run by run. */
  runs: RunChainVerification[]
}

export type StorageConfig =
  | { type: 'file'; path: string }
  | { type: 's3'; bucket: string; region: string; prefix?: string }
  | { type: 'cloud'; api_key: string; endpoint?: string }
  | { type: 'memory' }

export function verifyChain(entries: LedgerEntry[]): ChainVerification {
  // Entries chain per run_id, so group first (preserving stored order within
  // each run). Callers may pass a single run or a whole mixed-run log file.
  const byRun = new Map<string, { entry: LedgerEntry; index: number }[]>()
  for (let i = 0; i < entries.length; i++) {
    const item = { entry: entries[i], index: i }
    const list = byRun.get(entries[i].run_id)
    if (list) list.push(item)
    else byRun.set(entries[i].run_id, [item])
  }

  const runs: RunChainVerification[] = []
  // Track the earliest failure position in the ORIGINAL array across runs.
  let firstFailureIndex: number | null = null
  let firstFailureReason: ChainBreakReason | undefined

  for (const [run_id, items] of byRun) {
    const run: RunChainVerification = {
      run_id,
      valid: true,
      broken_at: null,
      entry_count: items.length,
    }

    for (let j = 0; j < items.length; j++) {
      const { entry, index } = items[j]

      // 1. Linkage: each entry must point at its predecessor's id, and the
      //    first entry at the genesis sentinel. Catches deleted, reordered,
      //    or truncated entries — per-entry hashes alone cannot.
      const expectedPrev = j === 0 ? GENESIS_PREV_ID : items[j - 1].entry.id
      let reason: ChainBreakReason | undefined
      if (entry.prev_id !== expectedPrev) {
        reason = j === 0 ? 'bad_genesis' : 'link_broken'
      } else {
        // 2. Integrity: re-derive the id from every other field. If anyone
        //    tampered with ts, run_id, agent_id, type, payload, risk_score,
        //    OR prev_id, the hash breaks here.
        const { id, human_summary, ...rest } = entry
        void human_summary
        if (computeEntryId(rest) !== id) reason = 'hash_mismatch'
      }

      if (reason) {
        run.valid = false
        run.broken_at = j
        run.reason = reason
        if (firstFailureIndex === null || index < firstFailureIndex) {
          firstFailureIndex = index
          firstFailureReason = reason
        }
        break
      }
    }

    runs.push(run)
  }

  return {
    valid: firstFailureIndex === null,
    broken_at: firstFailureIndex,
    reason: firstFailureReason,
    entry_count: entries.length,
    verified_at: Date.now(),
    runs,
  }
}

function applyFilter(entries: LedgerEntry[], filter: EntryFilter): LedgerEntry[] {
  return entries.filter(e => {
    if (filter.run_id && e.run_id !== filter.run_id) return false
    if (filter.agent_id && e.agent_id !== filter.agent_id) return false
    if (filter.type && e.type !== filter.type) return false
    if (filter.since && e.ts < filter.since) return false
    if (filter.until && e.ts > filter.until) return false
    if (filter.min_risk !== undefined && e.risk_score < filter.min_risk) return false
    return true
  })
}

export abstract class StorageAdapter {
  abstract append(entry: LedgerEntry): Promise<void>
  abstract query(filter: EntryFilter): Promise<LedgerEntry[]>
  async verify(run_id: string): Promise<ChainVerification> {
    const entries = await this.query({ run_id })
    return verifyChain(entries)
  }
}

export class MemoryAdapter extends StorageAdapter {
  private entries: LedgerEntry[] = []

  async append(entry: LedgerEntry): Promise<void> {
    this.entries.push(entry)
  }

  async query(filter: EntryFilter): Promise<LedgerEntry[]> {
    return applyFilter(this.entries, filter)
  }
}

export class FileAdapter extends StorageAdapter {
  constructor(private filePath: string) {
    super()
  }

  async append(entry: LedgerEntry): Promise<void> {
    await appendFile(this.filePath, JSON.stringify(entry) + '\n', 'utf8')
  }

  async query(filter: EntryFilter): Promise<LedgerEntry[]> {
    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch {
      return []
    }
    const entries = raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l) as LedgerEntry)
    return applyFilter(entries, filter)
  }
}

export class CloudAdapter extends StorageAdapter {
  private buffer: LedgerEntry[] = []
  private ws: WebSocket | null = null
  private endpoint: string

  constructor(
    private apiKey: string,
    endpoint?: string
  ) {
    super()
    this.endpoint = endpoint ?? 'wss://ingest.agentledger.io/v1/stream'
    this.connect()
  }

  private connect(): void {
    if (typeof WebSocket === 'undefined') return
    this.ws = new WebSocket(this.endpoint, ['v1', this.apiKey])
    this.ws.onopen = () => {
      this.buffer.forEach(e => this.ws!.send(JSON.stringify(e)))
      this.buffer = []
    }
    this.ws.onclose = () => setTimeout(() => this.connect(), 3000)
  }

  async append(entry: LedgerEntry): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(entry))
    } else {
      this.buffer.push(entry)
    }
  }

  async query(filter: EntryFilter): Promise<LedgerEntry[]> {
    const params = new URLSearchParams()
    if (filter.run_id) params.set('run_id', filter.run_id)
    if (filter.agent_id) params.set('agent_id', filter.agent_id)
    if (filter.type) params.set('type', filter.type)
    if (filter.since !== undefined) params.set('since', String(filter.since))
    if (filter.until !== undefined) params.set('until', String(filter.until))
    if (filter.min_risk !== undefined) params.set('min_risk', String(filter.min_risk))
    const qs = params.toString()
    const url = `https://api.agentledger.io/v1/entries${qs ? `?${qs}` : ''}`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    })
    const remote = (await res.json()) as LedgerEntry[]
    // Defensive client-side filter in case the server doesn't honor params.
    return applyFilter(remote, filter)
  }
}

export class LedgerStorage {
  private adapter: StorageAdapter

  constructor(config: StorageConfig) {
    switch (config.type) {
      case 'file':
        this.adapter = new FileAdapter(config.path)
        break
      case 'cloud':
        this.adapter = new CloudAdapter(config.api_key, config.endpoint)
        break
      case 'memory':
        this.adapter = new MemoryAdapter()
        break
      case 's3':
        throw new Error('S3Adapter: install @ai-agent-ledger/s3 for S3 support')
      default:
        throw new Error(`Unknown storage type: ${(config as { type?: string }).type}`)
    }
  }

  append(entry: LedgerEntry) {
    return this.adapter.append(entry)
  }
  query(filter: EntryFilter) {
    return this.adapter.query(filter)
  }
  verify(run_id: string) {
    return this.adapter.verify(run_id)
  }
}
