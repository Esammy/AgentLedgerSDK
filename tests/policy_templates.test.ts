import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PolicyEngine } from '../src/policy/engine'
import { POLICY_TEMPLATES } from '../src/policy/templates'

function ctx(tool: string, args: unknown[] = []) {
  return { tool, args, agent_id: 'a', run_id: 'r' }
}

describe('business_hours_only', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('blocks at 03:00 UTC for window 9–17', () => {
    vi.setSystemTime(new Date('2026-01-01T03:00:00Z'))
    const engine = new PolicyEngine([POLICY_TEMPLATES.business_hours_only(9, 17)])
    expect(engine.evaluate(ctx('whatever')).action).toBe('block')
  })

  it('allows at 10:00 UTC for window 9–17', () => {
    vi.setSystemTime(new Date('2026-01-01T10:00:00Z'))
    const engine = new PolicyEngine([POLICY_TEMPLATES.business_hours_only(9, 17)])
    expect(engine.evaluate(ctx('whatever')).action).toBe('allow')
  })

  it('blocks at 22:00 UTC for window 9–17 (the old bug)', () => {
    vi.setSystemTime(new Date('2026-01-01T22:00:00Z'))
    const engine = new PolicyEngine([POLICY_TEMPLATES.business_hours_only(9, 17)])
    expect(engine.evaluate(ctx('whatever')).action).toBe('block')
  })

  it('blocks at 17:00 UTC exactly (end is exclusive)', () => {
    vi.setSystemTime(new Date('2026-01-01T17:00:00Z'))
    const engine = new PolicyEngine([POLICY_TEMPLATES.business_hours_only(9, 17)])
    expect(engine.evaluate(ctx('whatever')).action).toBe('block')
  })

  it('supports overnight windows (22 → 4)', () => {
    const engine = new PolicyEngine([POLICY_TEMPLATES.business_hours_only(22, 4)])
    vi.setSystemTime(new Date('2026-01-01T23:00:00Z'))
    expect(engine.evaluate(ctx('whatever')).action).toBe('allow')
    vi.setSystemTime(new Date('2026-01-01T02:00:00Z'))
    expect(engine.evaluate(ctx('whatever')).action).toBe('allow')
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'))
    expect(engine.evaluate(ctx('whatever')).action).toBe('block')
  })
})

describe('pii_write_alert', () => {
  it('fires on a write tool whose args contain an email', () => {
    const engine = new PolicyEngine([POLICY_TEMPLATES.pii_write_alert(['#sec-ops'])])
    const d = engine.evaluate(ctx('write_file', [{ path: '/tmp/x', content: 'alice@corp.com' }]))
    expect(d.action).toBe('alert')
    expect(d.escalate_to).toEqual(['#sec-ops'])
  })

  it('does not fire on a write tool with no PII', () => {
    const engine = new PolicyEngine([POLICY_TEMPLATES.pii_write_alert()])
    expect(engine.evaluate(ctx('write_file', [{ path: '/tmp/x', content: 'hello' }])).action).toBe(
      'allow'
    )
  })

  it('does not fire on a read tool even with PII', () => {
    const engine = new PolicyEngine([POLICY_TEMPLATES.pii_write_alert()])
    expect(engine.evaluate(ctx('read_file', ['alice@corp.com'])).action).toBe('allow')
  })
})

describe('no_spend_over', () => {
  it('blocks when amount exceeds limit', () => {
    const engine = new PolicyEngine([POLICY_TEMPLATES.no_spend_over(500)])
    expect(engine.evaluate(ctx('create_payment', [{ amount: 750 }])).action).toBe('block')
  })
  it('allows when amount is under limit', () => {
    const engine = new PolicyEngine([POLICY_TEMPLATES.no_spend_over(500)])
    expect(engine.evaluate(ctx('create_payment', [{ amount: 100 }])).action).toBe('allow')
  })
  it('allows for non-payment tools regardless of amount', () => {
    const engine = new PolicyEngine([POLICY_TEMPLATES.no_spend_over(500)])
    expect(engine.evaluate(ctx('read_file', [{ amount: 9999 }])).action).toBe('allow')
  })
})

describe('no_delete', () => {
  it('blocks deleteRecord', () => {
    const engine = new PolicyEngine([POLICY_TEMPLATES.no_delete()])
    expect(engine.evaluate(ctx('deleteRecord', [{ id: 1 }])).action).toBe('block')
  })
  it('allows non-deletion tools', () => {
    const engine = new PolicyEngine([POLICY_TEMPLATES.no_delete()])
    expect(engine.evaluate(ctx('read_file')).action).toBe('allow')
  })
})

describe('external_email_gate', () => {
  it('gates emails to outside addresses', () => {
    const engine = new PolicyEngine([POLICY_TEMPLATES.external_email_gate('corp.com')])
    expect(engine.evaluate(ctx('send_email', [{ to: 'x@other.com' }])).action).toBe('approve_gate')
  })
  it('allows internal emails', () => {
    const engine = new PolicyEngine([POLICY_TEMPLATES.external_email_gate('corp.com')])
    expect(engine.evaluate(ctx('send_email', [{ to: 'alice@corp.com' }])).action).toBe('allow')
  })
})
