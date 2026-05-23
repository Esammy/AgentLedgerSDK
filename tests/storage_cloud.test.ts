import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { CloudAdapter } from '../src/storage/storage'

describe('CloudAdapter.query', () => {
  const originalFetch = globalThis.fetch
  const originalWS = (globalThis as { WebSocket?: unknown }).WebSocket

  beforeEach(() => {
    // No WebSocket → connect() is a no-op, no real network.
    delete (globalThis as { WebSocket?: unknown }).WebSocket
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalWS) (globalThis as { WebSocket?: unknown }).WebSocket = originalWS
  })

  it('forwards filter as URL query params', async () => {
    let capturedUrl = ''
    globalThis.fetch = (async (input: string | URL) => {
      capturedUrl = typeof input === 'string' ? input : input.toString()
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch

    const adapter = new CloudAdapter('sk_test')
    await adapter.query({ run_id: 'r1', type: 'tool_call', min_risk: 50 })

    expect(capturedUrl).toContain('run_id=r1')
    expect(capturedUrl).toContain('type=tool_call')
    expect(capturedUrl).toContain('min_risk=50')
  })

  it('still filters client-side if server returns unfiltered data', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify([
          { id: '1', prev_id: '0', run_id: 'r1', agent_id: 'a', ts: 1, type: 'tool_call', payload: {}, risk_score: 10, human_summary: '' },
          { id: '2', prev_id: '0', run_id: 'r2', agent_id: 'a', ts: 1, type: 'tool_call', payload: {}, risk_score: 10, human_summary: '' },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch

    const adapter = new CloudAdapter('sk_test')
    const result = await adapter.query({ run_id: 'r1' })
    expect(result.length).toBe(1)
    expect(result[0].run_id).toBe('r1')
  })
})
