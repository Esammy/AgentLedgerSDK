const HIGH_RISK_TOOLS = new Set([
  'send_email',
  'sendEmail',
  'email.send',
  'charge_card',
  'create_payment',
  'stripe_charge',
  'purchase',
  'delete_file',
  'deleteRecord',
  'drop_table',
  'rm',
  'unlink',
  'exec',
  'shell',
  'run_command',
  'subprocess',
  'write_file',
  'overwrite',
  'post_to_social',
  'publish',
])

const MEDIUM_RISK_TOOLS = new Set([
  'update_record',
  'patch',
  'upsert',
  'send_slack',
  'send_sms',
  'send_notification',
  'create_record',
  'insert',
  'read_file',
  'query_database',
  'search',
])

const WRITE_TOOLS = new Set([
  'write_file',
  'overwrite',
  'update_record',
  'create_record',
  'insert',
  'upsert',
  'patch',
  'drop_table',
  'deleteRecord',
  'delete_file',
  'db_write',
  'sql_execute',
])

const PII_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/,
  /\b(?:\d[ -]*?){13,16}\b/,
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,
]

const FINANCIAL_PATTERNS = [/\$[\d,]+(\.\d{2})?/, /"amount"\s*:\s*[\d.]+/, /"price"\s*:\s*[\d.]+/]

function classify(str: string): string[] {
  const out: string[] = []
  if (PII_PATTERNS.some(p => p.test(str))) out.push('PII')
  if (FINANCIAL_PATTERNS.some(p => p.test(str))) out.push('financial')
  if (str.includes('password') || str.includes('secret') || str.includes('api_key')) {
    out.push('credentials')
  }
  if (str.length > 10_000) out.push('large_payload')
  return out
}

/** Classify a tool's input arguments only — usable before the tool runs. */
export function classifyArgs(args: unknown[]): string[] {
  return classify(JSON.stringify(args))
}

/** Tools whose name suggests a write/mutation operation. */
export function isWriteTool(toolName: string): boolean {
  return WRITE_TOOLS.has(toolName)
}

export class RiskScorer {
  score(toolName: string, args: unknown[], output: unknown): number {
    let score = 0

    if (HIGH_RISK_TOOLS.has(toolName)) score += 60
    else if (MEDIUM_RISK_TOOLS.has(toolName)) score += 30
    else score += 10

    const argsStr = JSON.stringify(args)
    if (PII_PATTERNS.some(p => p.test(argsStr))) score += 20
    if (FINANCIAL_PATTERNS.some(p => p.test(argsStr))) score += 15
    if (Array.isArray(args[0]) && args[0].length > 10) score += 10

    if (output !== undefined) {
      const outStr = safeStringify(output)
      if (outStr.length > 10_000) score += 10
      if (PII_PATTERNS.some(p => p.test(outStr))) score += 5
    }

    return Math.min(100, score)
  }

  classifyData(args: unknown[], output: unknown): string[] {
    return classify(safeStringify([args, output]))
  }
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? ''
  } catch {
    return String(v)
  }
}
