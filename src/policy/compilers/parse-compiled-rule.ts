import type { CompiledRule, PolicyAction, PolicySeverity, RuleCondition } from '../types'

export class CompilerParseError extends Error {
  readonly code = 'COMPILER_PARSE_ERROR'
  constructor(message: string) {
    super(`[AgentLedger] ${message}`)
    this.name = 'CompilerParseError'
  }
}

const ACTIONS: PolicyAction[] = ['allow', 'block', 'approve_gate', 'log_only', 'alert']
const SEVERITIES: PolicySeverity[] = ['low', 'medium', 'high', 'critical']

/**
 * Strip optional markdown code fences from model output.
 */
export function extractJsonText(raw: string): string {
  let t = raw.trim()
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m
  const m = t.match(fence)
  if (m) t = m[1].trim()
  return t
}

function isPolicyAction(x: unknown): x is PolicyAction {
  return typeof x === 'string' && (ACTIONS as string[]).includes(x)
}

function isSeverity(x: unknown): x is PolicySeverity {
  return typeof x === 'string' && (SEVERITIES as string[]).includes(x)
}

const ACTION_ALIASES: Record<string, PolicyAction> = {
  deny: 'block',
  reject: 'block',
  deny_access: 'block',
  forbidden: 'block',
  permit: 'allow',
  grant: 'allow',
  approval_gate: 'approve_gate',
  approve: 'approve_gate',
  log: 'log_only',
  warn: 'alert',
  notify: 'alert',
}

function coercePolicyAction(raw: unknown): PolicyAction | null {
  if (typeof raw !== 'string') return null
  const key = raw.trim().toLowerCase().replace(/\s+/g, '_')
  const mapped = ACTION_ALIASES[key] ?? (key as PolicyAction)
  return isPolicyAction(mapped) ? mapped : null
}

const SEVERITY_ALIASES: Record<string, PolicySeverity> = {
  warning: 'medium',
  serious: 'high',
  severe: 'critical',
}

function coerceSeverity(raw: unknown): PolicySeverity | null {
  if (typeof raw !== 'string') return null
  const key = raw.trim().toLowerCase()
  const mapped = SEVERITY_ALIASES[key] ?? (key as PolicySeverity)
  return isSeverity(mapped) ? mapped : null
}

const CONDITION_TYPE_ALIASES: Record<string, string> = {
  toolmatch: 'tool_match',
  tools_match: 'tool_match',
  match_tool: 'tool_match',
  tool_name: 'tool_match',
  tool_names: 'tool_match',
  argcontains: 'arg_contains',
  argument_contains: 'arg_contains',
  timeafter: 'time_after',
  timebefore: 'time_before',
  timeoutside: 'time_outside',
  outside_hours: 'time_outside',
  business_hours: 'time_outside',
  dataclassification: 'data_classification',
}

function normalizeConditionTypeKey(t: unknown): string | undefined {
  if (typeof t !== 'string') return undefined
  const s = t.trim().toLowerCase().replace(/[\s-]+/g, '_')
  return CONDITION_TYPE_ALIASES[s] ?? s
}

function extractToolNames(o: Record<string, unknown>): string[] | null {
  for (const key of ['tools', 'tool_names', 'names'] as const) {
    const v = o[key]
    if (Array.isArray(v) && v.length > 0 && v.every(x => typeof x === 'string')) return v
  }
  const single = o.tool ?? o.name ?? o.tool_name
  if (typeof single === 'string' && single.length > 0) return [single]
  const generic = inferToolMatchFromGenericPredicate(o)
  return generic
}

/** LLMs sometimes emit equality predicates instead of tool_match. */
function inferToolMatchFromGenericPredicate(o: Record<string, unknown>): string[] | null {
  const op = String(o.operator ?? o.op ?? '').toLowerCase()
  const field = String(o.field ?? o.left ?? o.path ?? '').toLowerCase()
  const val = o.value ?? o.right ?? o.expected
  const okOp = op === '' || op === 'equals' || op === 'eq' || op === '==' || op === 'exact'
  const okField =
    field === 'tool'
    || field === 'tool_name'
    || field === 'toolname'
    || field === 'function'
    || field === 'function_name'
    || field.endsWith('.tool')
  if (okOp && okField && typeof val === 'string' && val.length > 0) return [val]
  return null
}

function normalizeCondition(c: unknown): RuleCondition {
  if (!c || typeof c !== 'object') throw new CompilerParseError('Invalid condition: not an object')
  const o = c as Record<string, unknown>
  let t = normalizeConditionTypeKey(o.type ?? o.kind ?? o.condition_type)

  const inferredTools = extractToolNames(o)
  if (!t && inferredTools) t = 'tool_match'

  if (t === 'tool_match') {
    const tools = inferredTools ?? (Array.isArray(o.tools) && o.tools.every(x => typeof x === 'string') ? o.tools as string[] : null)
    if (!tools || tools.length === 0) {
      throw new CompilerParseError('tool_match requires a non-empty tools: string[] (or tool / name string)')
    }
    return { type: 'tool_match', tools }
  }
  if (t === 'arg_contains') {
    const path = (o.path ?? o.arg_path) as unknown
    const pattern = (o.pattern ?? o.substring ?? o.text) as unknown
    if (typeof path !== 'string' || typeof pattern !== 'string') {
      throw new CompilerParseError('arg_contains requires path and pattern strings')
    }
    return { type: 'arg_contains', path, pattern }
  }
  if (t === 'arg_gt') {
    const path = o.path
    const value = o.value
    if (typeof path !== 'string' || typeof value !== 'number') {
      throw new CompilerParseError('arg_gt requires path string and value number')
    }
    return { type: 'arg_gt', path, value }
  }
  if (t === 'time_after' || t === 'time_before') {
    const hour = (o.hour_utc ?? o.hour) as unknown
    if (typeof hour !== 'number' || hour < 0 || hour > 23) {
      throw new CompilerParseError(`${t} requires hour_utc 0-23`)
    }
    return t === 'time_after' ? { type: 'time_after', hour_utc: hour } : { type: 'time_before', hour_utc: hour }
  }
  if (t === 'time_outside') {
    const start = (o.start_hour_utc ?? o.start_hour ?? o.start) as unknown
    const end = (o.end_hour_utc ?? o.end_hour ?? o.end) as unknown
    if (
      typeof start !== 'number' || start < 0 || start > 23
      || typeof end !== 'number' || end < 0 || end > 23
    ) {
      throw new CompilerParseError('time_outside requires start_hour_utc and end_hour_utc 0-23')
    }
    return { type: 'time_outside', start_hour_utc: start, end_hour_utc: end }
  }
  if (t === 'data_classification') {
    const classifications = o.classifications ?? o.labels
    if (!Array.isArray(classifications) || !classifications.every(x => typeof x === 'string')) {
      throw new CompilerParseError('data_classification requires classifications: string[]')
    }
    return { type: 'data_classification', classifications }
  }
  if (t === 'always') return { type: 'always' }
  throw new CompilerParseError(`Unknown condition type: ${String(t ?? o.type ?? o.kind)}`)
}

/**
 * Some models emit a single object that mixes keys (e.g. tool_match + arg_contains) instead of a typed `type` field.
 */
function expandCompoundCondition(c: unknown): unknown[] {
  if (!c || typeof c !== 'object') return [c]
  const o = c as Record<string, unknown>
  if (o.type != null || o.kind != null || o.condition_type != null) return [c]

  // { "tool_match": "exact", "arg_contains": { path: "[0].tool", pattern: "danger_tool" } }
  if (o.tool_match !== undefined && o.arg_contains && typeof o.arg_contains === 'object') {
    const ac = o.arg_contains as Record<string, unknown>
    const path = typeof ac.path === 'string' ? ac.path : ''
    const pattern = typeof ac.pattern === 'string' ? ac.pattern : ''
    const pathTargetsToolName =
      path === 'tool'
      || path.endsWith('.tool')
      || path.includes('tool_name')
      || /^\[\d+\]\.tool$/.test(path)
    if (pathTargetsToolName && pattern.length > 0) {
      return [{ type: 'tool_match', tools: [pattern] }]
    }
  }

  return [c]
}

function pickDescription(o: Record<string, unknown>): string {
  const candidates = [o.description, o.desc, o.summary, o.title, o.name]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c.trim()
    if (typeof c === 'number' || typeof c === 'boolean') return String(c)
  }
  return 'Policy rule (model omitted description)'
}

export function parseCompiledRule(raw: unknown): CompiledRule {
  if (!raw || typeof raw !== 'object') throw new CompilerParseError('CompiledRule must be a JSON object')
  let o = raw as Record<string, unknown>

  // Some providers wrap the rule (e.g. { compiled_rule: {...} })
  if (!Array.isArray(o.conditions) && typeof o.compiled_rule === 'object' && o.compiled_rule != null) {
    o = o.compiled_rule as Record<string, unknown>
  }
  if (!Array.isArray(o.conditions) && typeof o.rule === 'object' && o.rule != null) {
    o = o.rule as Record<string, unknown>
  }

  const id = typeof o.id === 'string' && o.id.length > 0
    ? o.id
    : typeof o.id === 'number' || typeof o.id === 'boolean'
      ? String(o.id)
      : typeof o.policy_id === 'string' && o.policy_id.length > 0
        ? o.policy_id
        : ''

  const description = pickDescription(o)
  const conditionsRaw = o.conditions
  const actionRaw = o.action ?? o.effect ?? o.decision ?? o.policy_action
  const severityRaw = o.severity ?? o.risk ?? o.level

  if (!id) throw new CompilerParseError('CompiledRule.id must be present as a non-empty string')
  let condList: unknown = conditionsRaw
  if (condList && typeof condList === 'object' && !Array.isArray(condList)) {
    condList = [condList]
  }
  if (!Array.isArray(condList) || condList.length === 0) {
    throw new CompilerParseError('CompiledRule.conditions must be a non-empty array')
  }
  const expanded = condList.flatMap(expandCompoundCondition)
  const action = coercePolicyAction(actionRaw)
  const severity = coerceSeverity(severityRaw)
  if (!action) throw new CompilerParseError('CompiledRule.action is invalid')
  if (!severity) throw new CompilerParseError('CompiledRule.severity is invalid')

  const conditions = expanded.map((c, i) => {
    try {
      return normalizeCondition(c)
    } catch (e) {
      if (e instanceof CompilerParseError) {
        const preview = typeof c === 'object' && c !== null
          ? JSON.stringify(c).slice(0, 400)
          : String(c)
        throw new CompilerParseError(`${e.message.replace(/^\[AgentLedger\] /, '')} (condition[${i}]: ${preview})`)
      }
      throw e
    }
  })

  let escalate_to: string[] | undefined
  if (o.escalate_to !== undefined) {
    if (!Array.isArray(o.escalate_to) || !o.escalate_to.every(x => typeof x === 'string')) {
      throw new CompilerParseError('CompiledRule.escalate_to must be string[] when present')
    }
    escalate_to = o.escalate_to
  }

  return { id, description, conditions, action, severity, escalate_to }
}

export function parseCompiledRuleFromModelText(raw: string): CompiledRule {
  const text = extractJsonText(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    throw new CompilerParseError(`Invalid JSON from compiler: ${e instanceof Error ? e.message : String(e)}`)
  }
  return parseCompiledRule(parsed)
}
