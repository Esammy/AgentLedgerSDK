import type { CompiledRule } from '../types'
import { COMPILED_RULE_JSON_SCHEMA_NAME, getCompiledRuleJsonSchema } from './compiled-rule-schema'
import { getPolicyCompilerSystemPrompt } from './prompts'
import { CompilerParseError, parseCompiledRuleFromModelText } from './parse-compiled-rule'
import type { LLMCompiler } from './llm-compiler'

export type ChatCompletionsResponseFormat = 'json_schema' | 'json_object'

export interface ChatCompletionsCompilerOptions {
  apiKey: string
  /** e.g. https://api.openai.com/v1 (no trailing slash) */
  baseUrl: string
  model: string
  /** Extra HTTP headers */
  headers?: Record<string, string>
  temperature?: number
  max_tokens?: number
  /**
   * json_schema enables OpenAI-like structured outputs when the provider supports it.
   * json_object is widely supported on OpenAI-compatible hosts.
   */
  responseFormat?: ChatCompletionsResponseFormat
  /** Appended as query string (e.g. Azure OpenAI api-version) */
  queryParams?: Record<string, string>
}

/**
 * OpenAI Chat Completions compatible compiler (also works with Groq, Mistral, xAI, Together, DeepSeek, etc.).
 */
export class ChatCompletionsCompiler implements LLMCompiler {
  private readonly opts: ChatCompletionsCompilerOptions

  constructor(opts: ChatCompletionsCompilerOptions) {
    const base = opts.baseUrl.replace(/\/$/, '')
    this.opts = { ...opts, baseUrl: base }
  }

  async compile(description: string): Promise<CompiledRule> {
    const path = `${this.opts.baseUrl}/chat/completions`
    const url = new URL(path)
    if (this.opts.queryParams) {
      for (const [k, v] of Object.entries(this.opts.queryParams)) {
        url.searchParams.set(k, v)
      }
    }
    const sys = getPolicyCompilerSystemPrompt()
    const user = `Compile this agent policy into one CompiledRule JSON object: ${JSON.stringify(description)}`

    const format = this.opts.responseFormat ?? 'json_object'
    const body: Record<string, unknown> = {
      model: this.opts.model,
      temperature: this.opts.temperature ?? 0,
      max_tokens: this.opts.max_tokens ?? 1024,
      messages: [
        { role: 'system', content: `${sys}\nRespond with JSON only.` },
        { role: 'user', content: user },
      ],
    }

    if (format === 'json_schema') {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: COMPILED_RULE_JSON_SCHEMA_NAME,
          strict: true,
          schema: getCompiledRuleJsonSchema(true),
        },
      }
    } else {
      body.response_format = { type: 'json_object' }
    }

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.opts.apiKey}`,
        ...this.opts.headers,
      },
      body: JSON.stringify(body),
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const errMsg =
        typeof (data as { error?: { message?: string } })?.error?.message === 'string'
          ? (data as { error: { message: string } }).error.message
          : JSON.stringify(data)
      throw new CompilerParseError(`Chat completions API error (${res.status}): ${errMsg}`)
    }

    const text = extractAssistantText(data)
    if (!text) throw new CompilerParseError('Empty assistant content from chat completions')

    return parseCompiledRuleFromModelText(text)
  }
}

function extractAssistantText(data: unknown): string | null {
  const choices = (data as { choices?: unknown })?.choices
  if (!Array.isArray(choices) || choices.length === 0) return null

  const content =
    choices[0] && typeof choices[0] === 'object'
      ? (choices[0] as { message?: { content?: unknown } }).message?.content
      : undefined

  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts = content.map((part: unknown) => {
      if (part && typeof part === 'object' && 'text' in part && typeof (part as { text: unknown }).text === 'string') {
        return (part as { text: string }).text
      }
      return ''
    })
    const joined = parts.join('')
    return joined.length ? joined : null
  }
  return null
}
