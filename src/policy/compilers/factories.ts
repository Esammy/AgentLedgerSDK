import { ChatCompletionsCompiler, type ChatCompletionsCompilerOptions } from './chat-completions'

/**
 * OpenAI — supports json_schema structured outputs on recent models.
 * Env: OPENAI_API_KEY
 */
export function createOpenAICompiler(
  apiKey: string,
  model = 'gpt-4o-mini'
): ChatCompletionsCompiler {
  return new ChatCompletionsCompiler({
    apiKey,
    baseUrl: 'https://api.openai.com/v1',
    model,
    responseFormat: 'json_schema',
  })
}

/**
 * Groq — OpenAI-compatible; use json_object for broad compatibility.
 * Env: GROQ_API_KEY
 */
export interface GroqCompilerOptions {
  apiKey: string
  model?: string
}

export function createGroqCompiler(options: GroqCompilerOptions): ChatCompletionsCompiler
export function createGroqCompiler(apiKey: string, model?: string): ChatCompletionsCompiler
export function createGroqCompiler(
  apiKeyOrOptions: string | GroqCompilerOptions,
  model = 'llama-3.3-70b-versatile'
): ChatCompletionsCompiler {
  const resolved =
    typeof apiKeyOrOptions === 'string'
      ? { apiKey: apiKeyOrOptions, model }
      : { apiKey: apiKeyOrOptions.apiKey, model: apiKeyOrOptions.model ?? 'llama-3.3-70b-versatile' }

  return new ChatCompletionsCompiler({
    apiKey: resolved.apiKey,
    baseUrl: 'https://api.groq.com/openai/v1',
    model: resolved.model,
    responseFormat: 'json_object',
  })
}

/**
 * Mistral — chat completions with JSON mode.
 * Env: MISTRAL_API_KEY
 */
export function createMistralCompiler(
  apiKey: string,
  model = 'mistral-large-latest'
): ChatCompletionsCompiler {
  return new ChatCompletionsCompiler({
    apiKey,
    baseUrl: 'https://api.mistral.ai/v1',
    model,
    responseFormat: 'json_object',
  })
}

/**
 * xAI Grok — OpenAI-compatible base URL.
 * Env: XAI_API_KEY
 */
export function createGrokCompiler(
  apiKey: string,
  model = 'grok-2-latest'
): ChatCompletionsCompiler {
  return new ChatCompletionsCompiler({
    apiKey,
    baseUrl: 'https://api.x.ai/v1',
    model,
    responseFormat: 'json_object',
  })
}

/**
 * Together AI — OpenAI-compatible.
 * Env: TOGETHER_API_KEY
 */
export function createTogetherCompiler(
  apiKey: string,
  model = 'meta-llama/Llama-3.3-70B-Instruct-Turbo'
): ChatCompletionsCompiler {
  return new ChatCompletionsCompiler({
    apiKey,
    baseUrl: 'https://api.together.xyz/v1',
    model,
    responseFormat: 'json_object',
  })
}

/**
 * DeepSeek — OpenAI-compatible.
 * Env: DEEPSEEK_API_KEY
 */
export function createDeepSeekCompiler(
  apiKey: string,
  model = 'deepseek-chat'
): ChatCompletionsCompiler {
  return new ChatCompletionsCompiler({
    apiKey,
    baseUrl: 'https://api.deepseek.com/v1',
    model,
    responseFormat: 'json_object',
  })
}

/**
 * Fireworks — OpenAI-compatible inference API.
 * Env: FIREWORKS_API_KEY
 */
export function createFireworksCompiler(
  apiKey: string,
  model = 'accounts/fireworks/models/llama-v3p3-70b-instruct'
): ChatCompletionsCompiler {
  return new ChatCompletionsCompiler({
    apiKey,
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    model,
    responseFormat: 'json_object',
  })
}

/**
 * Azure OpenAI Chat Completions — uses api-key header and api-version query param.
 * Env: AZURE_OPENAI_API_KEY; pass hostname and deployment id as shown in Azure portal.
 */
export function createAzureOpenAICompiler(opts: {
  apiKey: string
  /** Resource hostname without protocol, e.g. my-openai.openai.azure.com */
  resourceHost: string
  deployment: string
  apiVersion?: string
  responseFormat?: ChatCompletionsCompilerOptions['responseFormat']
}): ChatCompletionsCompiler {
  const host = opts.resourceHost.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const base = `https://${host}/openai/deployments/${opts.deployment}`
  return new ChatCompletionsCompiler({
    apiKey: opts.apiKey,
    baseUrl: base,
    model: opts.deployment,
    headers: { 'api-key': opts.apiKey },
    queryParams: { 'api-version': opts.apiVersion ?? '2024-08-01-preview' },
    responseFormat: opts.responseFormat ?? 'json_object',
  })
}
