//
// Policies are defined via PolicyInput.rule (a structured CompiledRule).
// Inputs without a `rule` are dropped; templates always supply one.
//
import type {
  CompiledRule,
  EvalContext,
  PolicyDecision,
  PolicyInput,
  RuleCondition,
} from './types'
import { classifyArgs } from '../risk/risk'

export class PolicyEngine {
  private rules: (CompiledRule & { input: PolicyInput })[] = []

  constructor(policies: PolicyInput[]) {
    for (const p of policies) {
      if (p.rule) this.rules.push({ ...p.rule, input: p })
    }
  }

  evaluate(ctx: EvalContext): PolicyDecision {
    // Lazy per-evaluation cache so data_classification only runs once
    // even across multiple rules.
    let classificationsCache: string[] | undefined
    const getClassifications = (): string[] => {
      if (classificationsCache === undefined) classificationsCache = classifyArgs(ctx.args)
      return classificationsCache
    }

    for (const rule of this.rules) {
      if (this.matchesAll(rule.conditions, ctx, getClassifications)) {
        return {
          action: rule.action,
          policy_id: rule.id,
          reason: rule.description,
          escalate_to: rule.escalate_to,
        }
      }
    }
    return { action: 'allow', reason: 'no matching policy' }
  }

  private matchesAll(
    conditions: RuleCondition[],
    ctx: EvalContext,
    getClassifications: () => string[]
  ): boolean {
    return conditions.every(cond => this.matchesOne(cond, ctx, getClassifications))
  }

  private matchesOne(
    cond: RuleCondition,
    ctx: EvalContext,
    getClassifications: () => string[]
  ): boolean {
    switch (cond.type) {
      case 'always':
        return true
      case 'tool_match':
        return cond.tools.includes(ctx.tool)
      case 'arg_contains': {
        const val = getPath(ctx.args, cond.path)
        if (typeof val !== 'string') return false
        return cond.pattern instanceof RegExp ? cond.pattern.test(val) : val.includes(cond.pattern)
      }
      case 'arg_gt': {
        const val = getPath(ctx.args, cond.path)
        return typeof val === 'number' && val > cond.value
      }
      case 'time_after':
        return new Date().getUTCHours() >= cond.hour_utc
      case 'time_before':
        return new Date().getUTCHours() < cond.hour_utc
      case 'time_outside': {
        const h = new Date().getUTCHours()
        const { start_hour_utc: s, end_hour_utc: e } = cond
        // Normal window (e.g. 9–17): blocked when h < s OR h >= e
        // Wrapping window (e.g. 22–4): blocked when h < s AND h >= e
        return s <= e ? h < s || h >= e : h < s && h >= e
      }
      case 'data_classification': {
        const found = getClassifications()
        return cond.classifications.some(c => found.includes(c))
      }
      default:
        return false
    }
  }
}

function getPath(obj: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  let cur: unknown = obj
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}
