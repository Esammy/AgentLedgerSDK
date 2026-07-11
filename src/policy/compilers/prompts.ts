/**
 * Shared compiler instructions — LLMs only run at policy compile-time, not per tool call.
 */

export function getPolicyCompilerSystemPrompt(): string {
  return `You are a policy compiler for AI agent governance. Convert natural language policies into a single JSON object called a CompiledRule.

Rules:
- Output valid JSON only. No markdown, no commentary outside JSON.
- "conditions" use AND semantics: every condition must match for the rule to apply.
- "pattern" for arg_contains MUST be a plain string suitable for substring match OR a literal regex-like pattern described as a simple string token (avoid complex regex; prefer simple literals like domain names).
- Prefer tool_match plus arg_contains paths like "[0].to" when emails or amounts are constrained.
- For business-hours or "only between X and Y" policies, use one time_outside condition with start_hour_utc and end_hour_utc (0-23); it matches whenever the current UTC hour falls OUTSIDE [start, end).
- "id": short alphanumeric identifier (e.g., policy slug).
- "action" MUST be exactly one of these lowercase strings: allow, block, approve_gate, log_only, alert.
- "severity" MUST be exactly one of: low, medium, high, critical.
Use "severity" responsibly: destructive or exfiltration policies should be critical or high.`
}
