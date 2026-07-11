/**
 * JSON Schema for CompiledRule (OpenAI Structured Outputs style).
 * Used by chat-completions compilers and adapted for Gemini where needed.
 */

export const COMPILED_RULE_JSON_SCHEMA_NAME = 'compiled_agent_policy_rule'

const conditionSchemas = [
  {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: ['tool_match'] },
      tools: { type: 'array', items: { type: 'string' } },
    },
    required: ['type', 'tools'],
  },
  {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: ['arg_contains'] },
      path: { type: 'string' },
      pattern: { type: 'string' },
    },
    required: ['type', 'path', 'pattern'],
  },
  {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: ['arg_gt'] },
      path: { type: 'string' },
      value: { type: 'number' },
    },
    required: ['type', 'path', 'value'],
  },
  {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: ['time_after'] },
      hour_utc: { type: 'integer', minimum: 0, maximum: 23 },
    },
    required: ['type', 'hour_utc'],
  },
  {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: ['time_before'] },
      hour_utc: { type: 'integer', minimum: 0, maximum: 23 },
    },
    required: ['type', 'hour_utc'],
  },
  {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: ['time_outside'] },
      start_hour_utc: { type: 'integer', minimum: 0, maximum: 23 },
      end_hour_utc: { type: 'integer', minimum: 0, maximum: 23 },
    },
    required: ['type', 'start_hour_utc', 'end_hour_utc'],
  },
  {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: ['data_classification'] },
      classifications: { type: 'array', items: { type: 'string' } },
    },
    required: ['type', 'classifications'],
  },
  {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: ['always'] },
    },
    required: ['type'],
  },
]

export function getCompiledRuleJsonSchema(_strict = true): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      description: { type: 'string' },
      conditions: {
        type: 'array',
        items: { anyOf: conditionSchemas },
        minItems: 1,
      },
      action: {
        type: 'string',
        enum: ['allow', 'block', 'approve_gate', 'log_only', 'alert'],
      },
      severity: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'critical'],
      },
      escalate_to: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['id', 'description', 'conditions', 'action', 'severity'],
  }
}
