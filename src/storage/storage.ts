import { createHash } from 'crypto'
import { appendFile, readFile } from 'fs/promises'
import type { LedgerEntry } from '../ledger/types'

export interface EntryFilter {
  run_id?: string
  agent_id?: string
  type?: LedgerEntry['type']
  since?: number
  until?: number
  min_risk?: number
}

export interface ChainVerification {
  valid: boolean
  broken_at: number | null
  entry_count: number
  verified_at: number
}

export type StorageConfig =
  | { type: 'file'; path: string }
  | { type: 's3'; bucket: string; region: string; prefix?: string }
  | { type: 'cloud'; api_key: string; endpoint?: string }
  | { type: 'memory' }

export function verifyChain(entries: LedgerEntry[]): ChainVerification {
  let valid = true
  let broken_at: number | null = null

  for (let i = 1; i < entries.length; i++) {
    const expected = createHash('sha256')
      .update(entries[i - 1].id + JSON.stringify(entries[i].payload))
      .digest('hex')
    if (expected !== entries[i].id) {
      valid = false
      broken_at = i
      break
    }
  }

  return { valid, broken_at, entry_count: entries.length, verified_at: Date.now() }
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
    return this.entries.filter(e => {
      if (filter.run_id && e.run_id !== filter.run_id) return false
      if (filter.agent_id && e.agent_id !== filter.agent_id) return false
      if (filter.type && e.type !== filter.type) return false
      if (filter.since && e.ts < filter.since) return false
      if (filter.until && e.ts > filter.until) return false
      if (filter.min_risk && e.risk_score < filter.min_risk) return false
      return true
    })
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
    return entries.filter(e => {
      if (filter.run_id && e.run_id !== filter.run_id) return false
      if (filter.agent_id && e.agent_id !== filter.agent_id) return false
      if (filter.type && e.type !== filter.type) return false
      if (filter.since && e.ts < filter.since) return false
      if (filter.until && e.ts > filter.until) return false
      if (filter.min_risk && e.risk_score < filter.min_risk) return false
      return true
    })
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

  async query(_filter: EntryFilter): Promise<LedgerEntry[]> {
    const res = await fetch('https://api.agentledger.io/v1/entries', {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    })
    return res.json() as Promise<LedgerEntry[]>
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
