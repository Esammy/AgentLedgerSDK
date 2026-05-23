import type { PolicyInput } from './types'

function escapeRegExpDomain(domain: string): string {
  return domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export const POLICY_TEMPLATES = {
  no_spend_over: (limitUSD: number): PolicyInput => ({
    description: `Never make purchases or external API calls costing over $${limitUSD}`,
    action: 'block',
    severity: 'critical',
    rule: {
      id: `no_spend_over_${limitUSD}`,
      description: `Spend limit: $${limitUSD}`,
      action: 'block',
      severity: 'critical',
      conditions: [
        {
          type: 'tool_match',
          tools: ['charge_card', 'create_payment', 'purchase', 'stripe_charge'],
        },
        { type: 'arg_gt', path: '[0].amount', value: limitUSD },
      ],
    },
  }),

  external_email_gate: (orgDomain = 'yourcompany.com'): PolicyInput => {
    const escaped = escapeRegExpDomain(orgDomain)
    const idSuffix = orgDomain.replace(/[^a-zA-Z0-9]+/g, '_')
    return {
      description: `Require approval for send_email to addresses outside @${orgDomain}`,
      action: 'approve_gate',
      severity: 'high',
      rule: {
        id: `external_email_gate_${idSuffix}`,
        description: `Outbound send_email outside @${orgDomain} requires human approval`,
        action: 'approve_gate',
        severity: 'high',
        conditions: [
          { type: 'tool_match', tools: ['send_email', 'sendEmail', 'email.send'] },
          {
            type: 'arg_contains',
            path: '[0].to',
            pattern: new RegExp(`^(?!.*@${escaped}$).+@.+\\..+$`),
          },
        ],
      },
    }
  },

  /**
   * Alert when a write-style tool call carries PII in its arguments.
   * Fires for write_file, update_record, insert, deleteRecord, etc. when args
   * contain anything our PII patterns recognize (emails, SSNs, card numbers,
   * phone numbers).
   */
  pii_write_alert: (escalateTo: string[] = []): PolicyInput => ({
    description: 'Alert on any database/file write whose args contain PII',
    action: 'alert',
    severity: 'high',
    escalate_to: escalateTo,
    rule: {
      id: 'pii_write_alert',
      description: 'PII detected in write-tool arguments',
      action: 'alert',
      severity: 'high',
      escalate_to: escalateTo,
      conditions: [
        {
          type: 'tool_match',
          tools: [
            'write_file',
            'overwrite',
            'update_record',
            'create_record',
            'insert',
            'upsert',
            'patch',
            'deleteRecord',
            'delete_file',
            'db_write',
            'sql_execute',
          ],
        },
        { type: 'data_classification', classifications: ['PII'] },
      ],
    },
  }),

  no_delete: (): PolicyInput => ({
    description: 'Never delete files or records — dry-run mode only',
    action: 'block',
    severity: 'critical',
    rule: {
      id: 'no_delete',
      description: 'Deletion blocked — dry-run only',
      action: 'block',
      severity: 'critical',
      conditions: [
        {
          type: 'tool_match',
          tools: ['delete_file', 'deleteRecord', 'drop_table', 'fs.rm', 'unlink', 'rm_rf'],
        },
      ],
    },
  }),

  /**
   * Block any tool call outside [startHour, endHour) UTC.
   * Supports windows that wrap midnight (e.g. start=22, end=4 = only 22:00–04:00 allowed).
   */
  business_hours_only: (startHour = 8, endHour = 18): PolicyInput => ({
    description: `Only allow agent actions between ${startHour}:00 and ${endHour}:00 UTC`,
    action: 'block',
    severity: 'medium',
    rule: {
      id: `business_hours_only_${startHour}_${endHour}`,
      description: `Action blocked outside business hours (${startHour}–${endHour} UTC)`,
      action: 'block',
      severity: 'medium',
      conditions: [
        { type: 'time_outside', start_hour_utc: startHour, end_hour_utc: endHour },
      ],
    },
  }),
}
