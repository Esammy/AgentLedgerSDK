// Policy types shared by engine, templates, and LLM compilers.

export type PolicyAction = 'allow' | 'block' | 'approve_gate' | 'log_only' | 'alert'
export type PolicySeverity = 'low' | 'medium' | 'high' | 'critical'

export type RuleCondition =
  | { type: 'tool_match'; tools: string[] }
  | { type: 'arg_contains'; path: string; pattern: string | RegExp }
  | { type: 'arg_gt'; path: string; value: number }
  | { type: 'time_after'; hour_utc: number }
  | { type: 'time_before'; hour_utc: number }
  | { type: 'data_classification'; classifications: string[] }
  | { type: 'always' }

export interface CompiledRule {
  id: string
  description: string
  conditions: RuleCondition[]
  action: PolicyAction
  severity: PolicySeverity
  escalate_to?: string[]
}

export interface PolicyInput {
  description: string
  action: PolicyAction
  severity?: PolicySeverity
  escalate_to?: string[]
  rule?: CompiledRule
}

export interface EvalContext {
  tool: string
  args: unknown[]
  agent_id: string
  run_id: string
}

export interface PolicyDecision {
  action: PolicyAction
  policy_id?: string
  reason: string
  escalate_to?: string[]
}
