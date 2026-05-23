import { createHash } from 'crypto'
import type { LedgerEntry } from './types'

/**
 * Deterministic JSON serialization with object keys sorted recursively.
 * `undefined` properties are dropped (same as JSON.stringify).
 */
export function canonicalStringify(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'undefined') return 'null'
  if (Array.isArray(value)) {
    return '[' + value.map(v => canonicalStringify(v === undefined ? null : v)).join(',') + ']'
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort()
    return (
      '{' +
      keys.map(k => JSON.stringify(k) + ':' + canonicalStringify(obj[k])).join(',') +
      '}'
    )
  }
  return 'null'
}

/**
 * Compute the SHA-256 id for a ledger entry. The hash covers every field
 * except `id` (the output) and `human_summary` (best-effort, may be async).
 * `prev_id` IS hashed — that's what chains entries together.
 */
export function computeEntryId(
  entry: Omit<LedgerEntry, 'id' | 'human_summary'>
): string {
  return createHash('sha256').update(canonicalStringify(entry)).digest('hex')
}

export const GENESIS_PREV_ID = '0'.repeat(64)
