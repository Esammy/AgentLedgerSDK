import type { CompiledRule } from '../types'

/** Implement to compile natural language into a CompiledRule once at startup. */
export interface LLMCompiler {
  compile(naturalLanguagePolicy: string): Promise<CompiledRule>
}
