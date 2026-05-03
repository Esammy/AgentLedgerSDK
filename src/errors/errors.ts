export class PolicyBlockError extends Error {
  readonly code = 'POLICY_BLOCK'
  constructor(reason: string) {
    super(`[AgentLedger] Action blocked by policy: ${reason}`)
    this.name = 'PolicyBlockError'
  }
}

export class ApprovalDeniedError extends Error {
  readonly code = 'APPROVAL_DENIED'
  constructor(reason: string) {
    super(`[AgentLedger] Approval gate denied: ${reason}`)
    this.name = 'ApprovalDeniedError'
  }
}

export class KillSwitchError extends Error {
  readonly code = 'KILL_SWITCH'
  constructor(run_id?: string) {
    super(`[AgentLedger] Agent run halted by kill switch${run_id ? ` (run: ${run_id})` : ''}`)
    this.name = 'KillSwitchError'
  }
}
