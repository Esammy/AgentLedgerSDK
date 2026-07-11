import { describe, it, expect, vi, afterEach } from 'vitest'
import { CompilerParseError, parseCompiledRuleFromModelText } from '../src/policy/compilers/parse-compiled-rule'
import { ChatCompletionsCompiler } from '../src/policy/compilers/chat-completions'
import { GeminiCompiler } from '../src/policy/compilers/gemini'
import { ClaudeCompiler } from '../src/policy/compilers/claude'
import { PolicyEngine } from '../src/policy/engine'

const validRuleJson = JSON.stringify({
  id: 'rule-1',
  description: 'Block dangerous tools',
  conditions: [{ type: 'tool_match', tools: ['delete_file'] }],
  action: 'block',
  severity: 'high',
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('parseCompiledRuleFromModelText', () => {
  it('parses fenced JSON markdown', () => {
    const text = '```json\n' + validRuleJson + '\n```'
    const rule = parseCompiledRuleFromModelText(text)
    expect(rule.id).toBe('rule-1')
    expect(rule.conditions[0]).toMatchObject({ type: 'tool_match', tools: ['delete_file'] })
  })

  it('throws CompilerParseError on invalid JSON', () => {
    expect(() => parseCompiledRuleFromModelText('not-json')).toThrow(CompilerParseError)
  })

  it('throws on malformed rule payload', () => {
    expect(() => parseCompiledRuleFromModelText('{"id":"x"}')).toThrow(CompilerParseError)
  })

  it('normalizes tag-less compound tool_match + arg_contains (some chat APIs)', () => {
    const hybrid = JSON.stringify({
      id: 'h1',
      description: 'block danger_tool',
      conditions: [
        {
          tool_match: 'exact',
          arg_contains: { path: '[0].tool', pattern: 'danger_tool' },
        },
      ],
      action: 'block',
      severity: 'high',
    })
    const rule = parseCompiledRuleFromModelText(hybrid)
    expect(rule.conditions[0]).toMatchObject({ type: 'tool_match', tools: ['danger_tool'] })
  })

  it('parses time_outside conditions (business-hours policies)', () => {
    const text = JSON.stringify({
      id: 'bh1',
      description: 'business hours only',
      conditions: [{ type: 'time_outside', start_hour_utc: 9, end_hour_utc: 17 }],
      action: 'block',
      severity: 'medium',
    })
    const rule = parseCompiledRuleFromModelText(text)
    expect(rule.conditions[0]).toMatchObject({
      type: 'time_outside',
      start_hour_utc: 9,
      end_hour_utc: 17,
    })
  })
})

describe('ChatCompletionsCompiler', () => {
  it('parses assistant message.content string', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: validRuleJson } }],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const compiler = new ChatCompletionsCompiler({
      apiKey: 'test-key',
      baseUrl: 'https://api.example.com/v1',
      model: 'test-model',
      responseFormat: 'json_object',
    })

    const rule = await compiler.compile('never delete production data')
    expect(rule.description).toBe('Block dangerous tools')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    expect((init as RequestInit).method).toBe('POST')
  })

  it('throws CompilerParseError on HTTP error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ error: { message: 'rate limited' } }),
      })
    )

    const compiler = new ChatCompletionsCompiler({
      apiKey: 'k',
      baseUrl: 'https://api.example.com/v1',
      model: 'm',
    })

    await expect(compiler.compile('x')).rejects.toThrow(CompilerParseError)
  })
})

describe('GeminiCompiler', () => {
  it('parses candidates text parts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: validRuleJson }] } }],
        }),
      })
    )

    const compiler = new GeminiCompiler({ apiKey: 'gem-key' })
    const rule = await compiler.compile('policy text')
    expect(rule.id).toBe('rule-1')
  })
})

describe('ClaudeCompiler', () => {
  it('parses Anthropic content blocks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: validRuleJson }],
        }),
      })
    )

    const compiler = new ClaudeCompiler({ apiKey: 'anthropic-key', model: 'claude-haiku-test' })
    const rule = await compiler.compile('policy')
    expect(rule.action).toBe('block')
  })
})

describe('PolicyEngine.addPolicyAsync', () => {
  it('compiles via the LLMCompiler once and enforces synchronously after', async () => {
    const compile = vi.fn().mockResolvedValue({
      id: 'compiled-1',
      description: 'Block danger_tool',
      conditions: [{ type: 'tool_match', tools: ['danger_tool'] }],
      action: 'allow', // engine must override with the input's declared action
      severity: 'low',
    })

    const engine = new PolicyEngine([])
    await engine.addPolicyAsync(
      { description: 'block any call to danger_tool', action: 'block', severity: 'high' },
      { compile }
    )

    expect(compile).toHaveBeenCalledTimes(1)

    const blocked = engine.evaluate({
      tool: 'danger_tool',
      args: [],
      agent_id: 'a',
      run_id: 'r',
    })
    expect(blocked.action).toBe('block')
    expect(blocked.policy_id).toBe('compiled-1')

    const allowed = engine.evaluate({
      tool: 'safe_tool',
      args: [],
      agent_id: 'a',
      run_id: 'r',
    })
    expect(allowed.action).toBe('allow')
  })
})
