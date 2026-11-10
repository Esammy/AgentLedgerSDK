import { appendFile, readFile, open } from 'fs/promises'
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
  | { type: 'cloud'; api_key: string; endpoint?: string; query_endpoint?: string }
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
    // Store a private copy so later mutation of caller-owned payload objects
    // can't silently rewrite history.
    this.entries.push(structuredClone(entry))
  }

  async query(filter: EntryFilter): Promise<LedgerEntry[]> {
    return structuredClone(applyFilter(this.entries, filter))
  }
}

export class FileAdapter extends StorageAdapter {
  private tailChecked = false

  constructor(private filePath: string) {
    super()
  }

  /**
   * After a crash the last line may be a partial write with no trailing
   * newline. Appending straight after it would corrupt the NEW entry too, so
   * check once per adapter and start a fresh line if needed.
   */
  private async needsLeadingNewline(): Promise<boolean> {
    if (this.tailChecked) return false
    this.tailChecked = true
    let fh
    try {
      fh = await open(this.filePath, 'r')
      const { size } = await fh.stat()
      if (size === 0) return false
      const buf = Buffer.alloc(1)
      await fh.read(buf, 0, 1, size - 1)
      return buf[0] !== 0x0a
    } catch {
      return false // file doesn't exist yet
    } finally {
      await fh?.close()
    }
  }

  async append(entry: LedgerEntry): Promise<void> {
    const prefix = (await this.needsLeadingNewline()) ? '\n' : ''
    await appendFile(this.filePath, prefix + JSON.stringify(entry) + '\n', 'utf8')
  }

  async query(filter: EntryFilter): Promise<LedgerEntry[]> {
    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch {
      return []
    }
    const entries: LedgerEntry[] = []
    let skipped = 0
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        entries.push(JSON.parse(line) as LedgerEntry)
      } catch {
        // A corrupt/partial line must not take down every query. Skipping it
        // leaves a gap that verifyChain reports as a broken link.
        skipped++
      }
    }
    if (skipped > 0) {
      console.warn(`[AgentLedger] ${this.filePath}: skipped ${skipped} unparseable line(s)`)
    }
    return applyFilter(entries, filter)
  }
}

const MAX_CLOUD_BUFFER = 10_000

export class CloudAdapter extends StorageAdapter {
  private buffer: LedgerEntry[] = []
  private ws: WebSocket | null = null
  private endpoint: string
  private queryEndpoint: string
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false

  constructor(
    private apiKey: string,
    endpoint?: string,
    queryEndpoint?: string
  ) {
    super()
    this.endpoint = endpoint ?? 'wss://ingest.agentledger.io/v1/stream'
    this.queryEndpoint = (queryEndpoint ?? 'https://api.agentledger.io/v1/entries').replace(/\/+$/, '')
    this.connect()
  }

  private connect(): void {
    if (this.closed || typeof WebSocket === 'undefined') return
    this.ws = new WebSocket(this.endpoint, ['v1', this.apiKey])
    this.ws.onopen = () => {
      this.buffer.forEach(e => this.ws!.send(JSON.stringify(e)))
      this.buffer = []
    }
    this.ws.onclose = () => {
      if (this.closed) return
      this.reconnectTimer = setTimeout(() => this.connect(), 3000)
      // Reconnect attempts must not keep the process alive on their own.
      if (typeof this.reconnectTimer.unref === 'function') this.reconnectTimer.unref()
    }
  }

  /** Stop reconnecting and close the socket. */
  close(): void {
    this.closed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.ws?.close()
    this.ws = null
  }

  async append(entry: LedgerEntry): Promise<void> {
    if (typeof WebSocket === 'undefined') {
      // Without a WebSocket implementation nothing would ever be sent; fail
      // loudly instead of buffering forever and reporting success.
      throw new Error(
        'CloudAdapter: no global WebSocket available (requires Node 22+ or a browser); cannot ship entries'
      )
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(entry))
      return
    }
    if (this.buffer.length >= MAX_CLOUD_BUFFER) {
      throw new Error(`CloudAdapter: offline buffer full (${MAX_CLOUD_BUFFER} entries)`)
    }
    this.buffer.push(entry)
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
    const url = `${this.queryEndpoint}${qs ? `?${qs}` : ''}`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    })
    if (!res.ok) {
      throw new Error(`CloudAdapter: query failed with HTTP ${res.status}`)
    }
    const remote = (await res.json()) as unknown
    if (!Array.isArray(remote)) {
      throw new Error('CloudAdapter: query returned a non-array response')
    }
    // Defensive client-side filter in case the server doesn't honor params.
    return applyFilter(remote as LedgerEntry[], filter)
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
        this.adapter = new CloudAdapter(config.api_key, config.endpoint, config.query_endpoint)
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
  /** Release adapter resources (sockets, timers). Safe on any adapter. */
  close() {
    ;(this.adapter as { close?: () => void }).close?.()
  }
}
