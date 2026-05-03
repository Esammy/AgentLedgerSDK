//
// Policies can be defined in two ways:
//   1. Natural language → compile once at startup with an LLMCompiler
//   2. Structured rule via PolicyInput.rule
//
import type {
  CompiledRule,
  EvalContext,
  PolicyDecision,
  PolicyInput,
  RuleCondition,
} from './types'

export class PolicyEngine {
  private rules: (CompiledRule & { input: PolicyInput })[] = []

  constructor(policies: PolicyInput[]) {
    for (const p of policies) {
      if (p.rule) {
        this.rules.push({ ...p.rule, input: p })
      } else {
        const heuristic = this.heuristicCompile(p)
        if (heuristic) this.rules.push({ ...heuristic, input: p })
      }
    }
  }

  evaluate(ctx: EvalContext): PolicyDecision {
    for (const rule of this.rules) {
      if (this.matchesAll(rule.conditions, ctx)) {
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

  private matchesAll(conditions: RuleCondition[], ctx: EvalContext): boolean {
    return conditions.every(cond => this.matchesOne(cond, ctx))
  }

  private matchesOne(cond: RuleCondition, ctx: EvalContext): boolean {
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
      case 'time_after': {
        return new Date().getUTCHours() >= cond.hour_utc
      }
      case 'time_before': {
        return new Date().getUTCHours() < cond.hour_utc
      }
      case 'data_classification':
        return false
      default:
        return false
    }
  }

  private heuristicCompile(input: PolicyInput): CompiledRule | null {
    const d = input.description.toLowerCase()
    const id = Math.random().toString(36).slice(2, 10)

    if (d.includes('send_email') || d.includes('send email')) {
      return {
        id,
        description: input.description,
        action: input.action,
        severity: input.severity ?? 'high',
        escalate_to: input.escalate_to,
        conditions: [
          { type: 'tool_match', tools: ['send_email', 'sendEmail', 'email.send'] },
          {
            type: 'arg_contains',
            path: '[0].to',
            pattern: /^(?!.*@(yourcompany\.com)$).+@.+\..+$/,
          },
        ],
      }
    }

    if (d.includes('delete') || d.includes('drop')) {
      return {
        id,
        description: input.description,
        action: input.action,
        severity: input.severity ?? 'critical',
        escalate_to: input.escalate_to,
        conditions: [
          {
            type: 'tool_match',
            tools: ['delete_file', 'deleteRecord', 'drop_table', 'rm', 'unlink'],
          },
        ],
      }
    }

    return null
  }
}

function randomId(): string {
  if (typeof globalThis.crypto !== 'undefined' && 'randomUUID' in globalThis.crypto) {
    return globalThis.crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2)
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
