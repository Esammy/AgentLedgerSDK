import type { PolicyInput } from './types'

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

  external_email_gate: (orgDomain = 'yourcompany.com'): PolicyInput => ({
    description: `Require approval before sending emails outside ${orgDomain}`,
    action: 'approve_gate',
    severity: 'high',
  }),

  pii_write_alert: (escalateTo: string[] = []): PolicyInput => ({
    description: 'Alert on any database write touching PII-classified fields',
    action: 'alert',
    severity: 'high',
    escalate_to: escalateTo,
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

  business_hours_only: (startHour = 8, endHour = 18): PolicyInput => ({
    description: `Only allow agent actions between ${startHour}:00 and ${endHour}:00 UTC`,
    action: 'block',
    severity: 'medium',
    rule: {
      id: 'business_hours_only',
      description: `Action blocked outside business hours (${startHour}–${endHour} UTC)`,
      action: 'block',
      severity: 'medium',
      conditions: [
        { type: 'always' },
        { type: 'time_before', hour_utc: startHour },
      ],
    },
  }),
}
