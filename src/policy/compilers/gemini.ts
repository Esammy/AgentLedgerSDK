import type { CompiledRule } from '../types'
import { getCompiledRuleJsonSchema } from './compiled-rule-schema'
import { getPolicyCompilerSystemPrompt } from './prompts'
import { CompilerParseError, parseCompiledRuleFromModelText } from './parse-compiled-rule'
import type { LLMCompiler } from './llm-compiler'

export interface GeminiCompilerOptions {
  apiKey: string
  /** Model id, e.g. gemini-2.5-flash */
  model?: string
  /** API base without trailing slash */
  baseUrl?: string
  temperature?: number
}

/**
 * Google Gemini — uses generateContent with JSON schema structured output.
 * Env: GEMINI_API_KEY (or pass apiKey explicitly).
 */
export class GeminiCompiler implements LLMCompiler {
  private readonly opts: {
    apiKey: string
    model: string
    baseUrl: string
    temperature: number
  }

  constructor(apiKey: string, options?: Omit<GeminiCompilerOptions, 'apiKey'>)
  constructor(options: GeminiCompilerOptions)
  constructor(
    apiKeyOrOpts: string | GeminiCompilerOptions,
    maybeOpts?: Omit<GeminiCompilerOptions, 'apiKey'>
  ) {
    if (typeof apiKeyOrOpts === 'string') {
      this.opts = {
        apiKey: apiKeyOrOpts,
        model: maybeOpts?.model ?? 'gemini-2.5-flash',
        baseUrl: (maybeOpts?.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, ''),
        temperature: maybeOpts?.temperature ?? 0,
      }
    } else {
      this.opts = {
        apiKey: apiKeyOrOpts.apiKey,
        model: apiKeyOrOpts.model ?? 'gemini-2.5-flash',
        baseUrl: (apiKeyOrOpts.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, ''),
        temperature: apiKeyOrOpts.temperature ?? 0,
      }
    }
  }

  async compile(description: string): Promise<CompiledRule> {
    const model = encodeURIComponent(this.opts.model)
    const url = `${this.opts.baseUrl}/models/${model}:generateContent?key=${encodeURIComponent(this.opts.apiKey)}`

    const system = `${getPolicyCompilerSystemPrompt()}\nRespond with JSON only matching the supplied schema.`
    const user = `Compile this agent policy into one CompiledRule JSON object: ${JSON.stringify(description)}`

    const schema = getCompiledRuleJsonSchema(true)

    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        temperature: this.opts.temperature,
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
      },
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg =
        typeof (data as { error?: { message?: string } })?.error?.message === 'string'
          ? (data as { error: { message: string } }).error.message
          : JSON.stringify(data)
      throw new CompilerParseError(`Gemini API error (${res.status}): ${msg}`)
    }

    const text = extractGeminiText(data)
    if (!text) throw new CompilerParseError('Empty Gemini response text')

    return parseCompiledRuleFromModelText(text)
  }
}

function extractGeminiText(data: unknown): string | null {
  const cand = (data as { candidates?: unknown[] })?.candidates?.[0]
  if (!cand || typeof cand !== 'object') return null
  const content = (cand as { content?: { parts?: unknown[] } }).content
  const parts = content?.parts
  if (!Array.isArray(parts)) return null

  const texts = parts.map((p) => {
    if (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string') {
      return (p as { text: string }).text
    }
    return ''
  })
  const joined = texts.join('')
  return joined.length ? joined : null
}
