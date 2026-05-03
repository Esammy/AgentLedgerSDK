/** Types shared between ledger persistence and instrumentation. */

export interface ToolCallPayload {
  tool_name: string
  tool_input: unknown
  tool_output?: unknown
  error?: string
  duration_ms: number
  data_classifications: string[]
}

export interface LLMDecisionPayload {
  model: string
  prompt_tokens: number
  completion_tokens: number
  reasoning_summary: string
  chosen_action: string
  alternatives_considered: string[]
}

export interface PolicyBlockPayload {
  policy_id: string
  policy_text: string
  blocked_action: string
  escalated_to?: string[]
  override_token?: string
}

export type EntryPayload = ToolCallPayload | LLMDecisionPayload | PolicyBlockPayload

export interface LedgerEntry {
  id: string
  prev_id: string
  run_id: string
  agent_id: string
  ts: number
  type: 'tool_call' | 'llm_decision' | 'policy_block' | 'approval_gate'
  payload: EntryPayload
  risk_score: number
  human_summary: string
}

export type AgentLike = {
  id?: string
  tools?: Tool[]
  llm?: LLMInterface
  [key: string]: unknown
}

export interface Tool {
  name: string
  description: string
  func: (...args: unknown[]) => Promise<unknown>
  schema?: object
}

export interface LLMInterface {
  invoke: (...args: unknown[]) => Promise<unknown>
  [key: string]: unknown
}
