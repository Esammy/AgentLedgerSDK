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

const PII_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/,
  /\b(?:\d[ -]*?){13,16}\b/,
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,
]

const FINANCIAL_PATTERNS = [/\$[\d,]+(\.\d{2})?/, /"amount"\s*:\s*[\d.]+/, /"price"\s*:\s*[\d.]+/]

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

    return Math.min(100, score)
  }

  classifyData(args: unknown[], output: unknown): string[] {
    const classifications: string[] = []
    const str = JSON.stringify([args, output])

    if (PII_PATTERNS.some(p => p.test(str))) classifications.push('PII')
    if (FINANCIAL_PATTERNS.some(p => p.test(str))) classifications.push('financial')
    if (str.includes('password') || str.includes('secret') || str.includes('api_key')) {
      classifications.push('credentials')
    }
    if (str.length > 10_000) classifications.push('large_payload')

    return classifications
  }
}
