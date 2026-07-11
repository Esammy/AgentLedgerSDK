import type { CompiledRule } from '../types'
import { getPolicyCompilerSystemPrompt } from './prompts'
import { CompilerParseError, parseCompiledRuleFromModelText } from './parse-compiled-rule'
import type { LLMCompiler } from './llm-compiler'

export interface ClaudeCompilerOptions {
  apiKey: string
  model?: string
  anthropicVersion?: string
  maxTokens?: number
}

interface ResolvedClaudeCompilerOptions {
  apiKey: string
  model: string
  anthropicVersion: string
  maxTokens: number
}

/**
 * Anthropic Messages API — compiles natural language to a CompiledRule.
 * Env: ANTHROPIC_API_KEY
 */
export class ClaudeCompiler implements LLMCompiler {
  private readonly opts: ResolvedClaudeCompilerOptions

  constructor(apiKey: string, options?: Omit<ClaudeCompilerOptions, 'apiKey'>)
  constructor(options: ClaudeCompilerOptions)
  constructor(apiKeyOrOpts: string | ClaudeCompilerOptions, maybeOpts?: Omit<ClaudeCompilerOptions, 'apiKey'>) {
    if (typeof apiKeyOrOpts === 'string') {
      this.opts = {
        apiKey: apiKeyOrOpts,
        model: maybeOpts?.model ?? 'claude-haiku-4-5-20251001',
        anthropicVersion: maybeOpts?.anthropicVersion ?? '2023-06-01',
        maxTokens: maybeOpts?.maxTokens ?? 1024,
      }
    } else {
      this.opts = {
        apiKey: apiKeyOrOpts.apiKey,
        model: apiKeyOrOpts.model ?? 'claude-haiku-4-5-20251001',
        anthropicVersion: apiKeyOrOpts.anthropicVersion ?? '2023-06-01',
        maxTokens: apiKeyOrOpts.maxTokens ?? 1024,
      }
    }
  }

  async compile(description: string): Promise<CompiledRule> {
    const system = `${getPolicyCompilerSystemPrompt()}\nOutput ONLY valid JSON for one CompiledRule object. No markdown.`
    const user = `Compile this policy: ${JSON.stringify(description)}`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.opts.apiKey,
        'anthropic-version': this.opts.anthropicVersion,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.opts.model,
        max_tokens: this.opts.maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg =
        typeof (data as { error?: { message?: string } })?.error?.message === 'string'
          ? (data as { error: { message: string } }).error.message
          : JSON.stringify(data)
      throw new CompilerParseError(`Anthropic API error (${res.status}): ${msg}`)
    }

    const text = extractAnthropicText(data)
    if (!text) throw new CompilerParseError('Empty assistant content from Anthropic')

    return parseCompiledRuleFromModelText(text)
  }
}

function extractAnthropicText(data: unknown): string | null {
  const blocks = (data as { content?: unknown })?.content
  if (!Array.isArray(blocks)) return null

  const parts: string[] = []
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    const b = block as { type?: string; text?: string }
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
  }
  const joined = parts.join('')
  return joined.length ? joined : null
}
