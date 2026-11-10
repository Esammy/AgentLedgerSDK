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
  if (typeof value === 'bigint') return JSON.stringify(value.toString())
  if (Array.isArray(value)) {
    return '[' + value.map(v => canonicalStringify(v === undefined ? null : v)).join(',') + ']'
  }
  if (typeof value === 'object') {
    // Mirror JSON.stringify: honour toJSON (Date, URL, ...) so the hash of a
    // live entry equals the hash of the same entry after a storage round-trip.
    const withToJSON = value as { toJSON?: () => unknown }
    if (typeof withToJSON.toJSON === 'function') return canonicalStringify(withToJSON.toJSON())
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
 * Normalize a value to exactly what survives a JSON storage round-trip, so
 * the id computed at write time matches the id recomputed at verify time.
 * Dates become ISO strings, Maps/Sets become `{}`/`{}` (as JSON would), BigInt
 * becomes a string, circular references become "[Circular]", and `undefined`
 * properties are dropped. The result is a fresh deep copy, so later mutation
 * of the caller's objects cannot alter the recorded entry.
 */
export function normalizeForLedger<T>(value: T): T {
  const ancestors: unknown[] = []
  const json = JSON.stringify(value, function (this: unknown, _key, v: unknown) {
    // `this` is the object holding `_key`; unwind the ancestor stack to it.
    while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) ancestors.pop()
    if (typeof v === 'bigint') return v.toString()
    if (typeof v === 'object' && v !== null) {
      if (ancestors.includes(v)) return '[Circular]'
      ancestors.push(v)
    }
    return v
  })
  return (json === undefined ? value : JSON.parse(json)) as T
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
