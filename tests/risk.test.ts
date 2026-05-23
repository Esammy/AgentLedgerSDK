import { describe, it, expect } from 'vitest'
import { RiskScorer, classifyArgs } from '../src/risk/risk'

describe('RiskScorer', () => {
  const scorer = new RiskScorer()

  it('scores known high-risk tools higher than low-risk', () => {
    const high = scorer.score('charge_card', [{ amount: 50 }], null)
    const low = scorer.score('search', [{ q: 'cats' }], null)
    expect(high).toBeGreaterThan(low)
  })

  it('adds risk for PII in args', () => {
    const plain = scorer.score('read_file', [{ path: '/a' }], null)
    const pii = scorer.score('read_file', [{ path: '/a', email: 'a@b.com' }], null)
    expect(pii).toBeGreaterThan(plain)
  })

  it('factors output size into score', () => {
    const small = scorer.score('search', ['hi'], { rows: [1] })
    const big = scorer.score('search', ['hi'], { rows: 'x'.repeat(15_000) })
    expect(big).toBeGreaterThan(small)
  })

  it('caps at 100', () => {
    const s = scorer.score(
      'charge_card',
      [{ amount: 999, email: 'x@y.com', password: 'secret' }],
      { huge: 'x'.repeat(20_000) }
    )
    expect(s).toBeLessThanOrEqual(100)
  })
})

describe('classifyArgs', () => {
  it('flags PII', () => {
    expect(classifyArgs([{ email: 'a@b.com' }])).toContain('PII')
  })
  it('flags financial', () => {
    expect(classifyArgs([{ amount: 100 }])).toContain('financial')
  })
  it('flags credentials', () => {
    expect(classifyArgs([{ api_key: 'sk_test' }])).toContain('credentials')
  })
  it('returns empty for clean args', () => {
    expect(classifyArgs([{ foo: 'bar' }])).toEqual([])
  })
})
