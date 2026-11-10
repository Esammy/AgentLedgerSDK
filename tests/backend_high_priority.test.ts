import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, appendFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import net from 'node:net'
import { AgentLedger } from '../src/ledger/ledger'
import { LedgerStorage, CloudAdapter, FileAdapter } from '../src/storage/storage'
import { createDashboardServer } from '../src/server'

const base = { agent_id: 'a', ts: 1, type: 'tool_call' as const, risk_score: 0 }
const payload = (extra: Record<string, unknown> = {}) => ({
  tool_name: 't',
  tool_input: [],
  tool_output: null,
  duration_ms: 1,
  data_classifications: [],
  ...extra,
})

describe('chain head only advances after a successful append', () => {
  it('a failed write does not break later verification', async () => {
    const ledger = new AgentLedger({ agent_id: 'a', storage: { type: 'memory' } })
    await ledger.record({ ...base, run_id: 'r', payload: payload() })

    const storage = ledger.storage as unknown as { append: LedgerStorage['append'] }
    const realAppend = storage.append.bind(ledger.storage)
    storage.append = () => Promise.reject(new Error('disk full'))
    await expect(ledger.record({ ...base, run_id: 'r', payload: payload() })).rejects.toThrow('disk full')
    storage.append = realAppend

    await ledger.record({ ...base, run_id: 'r', payload: payload() })
    const result = await ledger.storage.verify('r')
    expect(result.valid).toBe(true)
    expect(result.entry_count).toBe(2)
  })
})

describe('hash survives a JSON storage round-trip', () => {
  let dir: string
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }))

  it('verifies entries containing Date, BigInt and circular values from a file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'al-'))
    const file = join(dir, 'ledger.jsonl')
    const ledger = new AgentLedger({ agent_id: 'a', storage: { type: 'file', path: file } })
    const circular: Record<string, unknown> = { name: 'loop' }
    circular.self = circular
    await ledger.record({
      ...base,
      run_id: 'r',
      payload: payload({ tool_output: { when: new Date(0), big: 10n, circular } }),
    })
    await ledger.record({ ...base, run_id: 'r', payload: payload() })

    const fresh = new AgentLedger({ agent_id: 'a', storage: { type: 'file', path: file } })
    const result = await fresh.storage.verify('r')
    expect(result.valid).toBe(true)
  })
})

describe('MemoryAdapter isolates stored entries', () => {
  it('mutating the original payload afterwards does not alter the ledger', async () => {
    const ledger = new AgentLedger({ agent_id: 'a', storage: { type: 'memory' } })
    const output = { secret: 'original' }
    await ledger.record({ ...base, run_id: 'r', payload: payload({ tool_output: output }) })
    output.secret = 'changed'
    const result = await ledger.storage.verify('r')
    expect(result.valid).toBe(true)
    const [entry] = await ledger.storage.query({ run_id: 'r' })
    expect((entry.payload as { tool_output: typeof output }).tool_output.secret).toBe('original')
  })
})

describe('FileAdapter tolerates corrupt lines', () => {
  let dir: string
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }))

  it('keeps working after a partial trailing write and flags the gap', async () => {
    dir = mkdtempSync(join(tmpdir(), 'al-'))
    const file = join(dir, 'ledger.jsonl')
    const first = new AgentLedger({ agent_id: 'a', storage: { type: 'file', path: file } })
    await first.record({ ...base, run_id: 'r', payload: payload() })
    appendFileSync(file, '{"id":"trunc') // crash mid-write, no newline

    const second = new AgentLedger({ agent_id: 'a', storage: { type: 'file', path: file } })
    const entry = await second.record({ ...base, run_id: 'r', payload: payload() })

    const entries = await new FileAdapter(file).query({ run_id: 'r' })
    expect(entries).toHaveLength(2) // no throw; new entry not glued to the partial line
    expect(entries[1].id).toBe(entry.id)
    expect(readFileSync(file, 'utf8').split('\n').filter(Boolean)).toHaveLength(3)
  })

  it('query does not throw on garbage', async () => {
    dir = mkdtempSync(join(tmpdir(), 'al-'))
    const file = join(dir, 'ledger.jsonl')
    writeFileSync(file, 'not json\n')
    expect(await new FileAdapter(file).query({})).toEqual([])
  })
})

describe('CloudAdapter', () => {
  const originalFetch = globalThis.fetch
  const originalWS = (globalThis as { WebSocket?: unknown }).WebSocket
  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalWS) (globalThis as { WebSocket?: unknown }).WebSocket = originalWS
  })

  it('honours query_endpoint', async () => {
    delete (globalThis as { WebSocket?: unknown }).WebSocket
    let seen = ''
    globalThis.fetch = (async (u: string | URL) => {
      seen = String(u)
      return new Response('[]', { status: 200 })
    }) as typeof fetch
    await new CloudAdapter('k', undefined, 'https://example.test/v9/entries/').query({ run_id: 'x' })
    expect(seen).toBe('https://example.test/v9/entries?run_id=x')
  })

  it('rejects on non-2xx and non-array responses', async () => {
    delete (globalThis as { WebSocket?: unknown }).WebSocket
    const adapter = new CloudAdapter('k')
    globalThis.fetch = (async () => new Response('{"error":"no"}', { status: 500 })) as typeof fetch
    await expect(adapter.query({})).rejects.toThrow('HTTP 500')
    globalThis.fetch = (async () => new Response('{"error":"no"}', { status: 200 })) as typeof fetch
    await expect(adapter.query({})).rejects.toThrow('non-array')
  })

  it('append fails loudly when no WebSocket implementation exists', async () => {
    delete (globalThis as { WebSocket?: unknown }).WebSocket
    const adapter = new CloudAdapter('k')
    await expect(adapter.append({} as never)).rejects.toThrow('WebSocket')
  })
})

describe('dashboard server survives malformed requests', () => {
  it('returns 400 for an unparseable request target instead of crashing', async () => {
    const ledger = new AgentLedger({ agent_id: 'a', storage: { type: 'memory' } })
    const server = createDashboardServer(ledger)
    await server.listen({ port: 0 })
    const port = (server.httpServer.address() as net.AddressInfo).port
    try {
      const reply = await new Promise<string>((resolve, reject) => {
        const sock = net.connect(port, '127.0.0.1', () => {
          sock.write('GET // HTTP/1.1\r\nHost: \r\nConnection: close\r\n\r\n')
        })
        let data = ''
        sock.on('data', c => (data += c))
        sock.on('end', () => resolve(data))
        sock.on('error', reject)
      })
      expect(reply).toMatch(/^HTTP\/1\.1 400/)
      // Server is still alive:
      const ok = await fetch(`http://127.0.0.1:${port}/health`)
      expect(ok.status).toBe(200)
    } finally {
      await server.close()
    }
  })
})
