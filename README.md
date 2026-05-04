# AgentLedger SDK 🛡️⛓️

**Runtime kill switch, audit trail, and policy enforcement for AI agents. Add it in 3 lines.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![NPM Version](https://img.shields.io/npm/v/@ai-agent-ledger/sdk)](https://www.npmjs.com/package/@ai-agent-ledger/sdk)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-blue)](https://www.typescriptlang.org/)
[![npm downloads](https://img.shields.io/npm/dm/@ai-agent-ledger/sdk)](https://www.npmjs.com/package/@ai-agent-ledger/sdk)

---

<!-- Replace this line with your demo.gif once recorded -->
> 🎬 **[Demo GIF coming soon]** — See a policy block and kill switch fire in real-time.
<!-- <img src="./demo.gif" alt="AgentLedger demo: policy block and kill switch in action" width="800" /> -->

---

## Install

```bash
npm install @ai-agent-ledger/sdk
```

```typescript
import { AgentLedger, POLICY_TEMPLATES } from '@ai-agent-ledger/sdk'

const ledger = new AgentLedger({ agent_id: 'my-agent', storage: { type: 'file', path: './audit.ndjson' }, policies: [POLICY_TEMPLATES.no_spend_over(500)] })
const agent = ledger.wrap(myExistingAgent) // every tool call is now governed
```

---

## Why this exists

We were running an AI agent in a payment workflow. One night, the agent queued 47 payment transactions totalling $230,000 — none of them were authorised. By the time we noticed, 12 had already executed. We had no kill switch. No audit trail. No way to know *why* it happened.

We looked for a middleware layer we could drop in front of any agent framework — something that would intercept tool calls before they execute, enforce policies, write a tamper-evident log, and give us a kill switch we could hit from anywhere. It didn't exist. So we built it.

AgentLedger is that layer. It wraps your agent's tools, evaluates policies synchronously before each call, appends every event to a SHA-256 hash chain you can verify later, and gives you a kill switch you can trigger in under 50ms from a dashboard API.

---

## Framework Integrations

### LangChain

```typescript
import { ChatOpenAI } from '@langchain/openai'
import { AgentLedger, POLICY_TEMPLATES } from '@ai-agent-ledger/sdk'

const ledger = new AgentLedger({
  agent_id: 'langchain-agent',
  storage: { type: 'file', path: './audit.ndjson' },
  policies: [POLICY_TEMPLATES.no_delete(), POLICY_TEMPLATES.no_spend_over(1000)]
})

// Wrap your tools before passing them to the agent
const rawTools = [sendEmailTool, queryDatabaseTool, createPaymentTool]
const agent = ledger.wrap({ id: 'langchain-agent', tools: rawTools })

// Now pass agent.tools to your LangChain executor as normal
// Every call is intercepted, risk-scored, and hash-chained
```

> Full example: [`examples/langchain_integration.ts`](./examples/langchain_integration.ts)

---

### Anthropic (Claude Tool Use)

```typescript
import Anthropic from '@anthropic-ai/sdk'
import { AgentLedger, POLICY_TEMPLATES, PolicyBlockError } from '@ai-agent-ledger/sdk'

const ledger = new AgentLedger({
  agent_id: 'claude-agent',
  storage: { type: 'memory' },
  policies: [POLICY_TEMPLATES.no_delete()]
})

const myTools = [{ name: 'query_db', description: 'Query the database', func: async (...args) => queryDb(...args) }]
const governed = ledger.wrap({ id: 'claude-agent', tools: myTools })

// Use governed.tools as your Anthropic tool handlers
```

> Full example: [`examples/anthropic_integration.ts`](./examples/anthropic_integration.ts)

---

### Raw OpenAI (Function Calling)

```typescript
import OpenAI from 'openai'
import { AgentLedger, POLICY_TEMPLATES } from '@ai-agent-ledger/sdk'

const ledger = new AgentLedger({
  agent_id: 'openai-agent',
  storage: { type: 'memory' },
  policies: [POLICY_TEMPLATES.no_spend_over(500)]
})

const myTools = [{ name: 'create_payment', description: 'Create a payment', func: async (...args) => processPayment(...args) }]
const governed = ledger.wrap({ id: 'openai-agent', tools: myTools })

// Call governed.tools[0].func() — it runs your policy check first, then the real function
```

> Full example: [`examples/openai_integration.ts`](./examples/openai_integration.ts)

---

### CrewAI / AutoGen / Custom Agents

Any object with a `tools` array works:

```typescript
const myAgent = {
  id: 'my-crew-agent',
  tools: [
    { name: 'send_report', description: 'Send a report email', func: async (...args) => sendEmail(...args) },
    { name: 'write_file',  description: 'Write to disk',       func: async (...args) => writeFile(...args) }
  ]
}

const governed = ledger.wrap(myAgent)
// governed.tools[*].func is now intercepted — policies run, entries are logged
```

---

## Key Features

*   **🛡️ Policy Enforcement:** Block or gate tool calls with deterministic rules — no LLM in the enforcement path.
*   **⛓️ Tamper-Evident Ledger:** Every event is SHA-256 hash-chained. Any modification to the log breaks the chain at that point.
*   **🛑 Kill Switch:** Call `ledger.killSwitch(run_id)` — the next tool invocation for that run throws immediately.
*   **🔍 Risk Scoring:** Heuristic 0–100 scoring on tool names, arguments (PII/credential patterns), and payload size.
*   **🧵 Request-Scoped Runs:** `ledger.run(cb, run_id)` uses `AsyncLocalStorage` to isolate audit context across concurrent async requests.
*   **🤖 Framework Agnostic:** Works with LangChain, CrewAI, Anthropic, OpenAI, or any custom agent.

---

## Built-in Policy Templates

```typescript
POLICY_TEMPLATES.no_spend_over(500)              // Block any payment tool where amount > $500
POLICY_TEMPLATES.no_delete()                     // Block tools matching deletion patterns
POLICY_TEMPLATES.external_email_gate('corp.com') // Require approval before emailing outside domain
POLICY_TEMPLATES.business_hours_only(9, 17)      // Block all tool calls outside 09:00–17:00 UTC
POLICY_TEMPLATES.pii_write_alert(['#sec-ops'])   // Alert channel when PII detected in DB writes
```

---

## Approval Gates

```typescript
import { PolicyBlockError, ApprovalDeniedError } from '@ai-agent-ledger/sdk'

try {
  await governed.tools[0].func({ to: 'vendor@external.com', body: '...' })
} catch (err) {
  if (err instanceof PolicyBlockError) {
    // Blocked outright — check err.policy_id for which rule fired
  }
  if (err instanceof ApprovalDeniedError) {
    // A human reviewed and denied the approval gate
  }
}

// In your approval handler (e.g. from a dashboard or Slack webhook):
await ledger.approveGate(token, 'alice@corp.com')
// or
await ledger.denyGate(token, 'alice@corp.com')
```

---

## Kill Switch

```typescript
// Halt a specific run
await ledger.killSwitch('run-abc-123')

// Global halt — stops all future tool calls across all runs
await ledger.killSwitch()
```

---

## Audit Dashboard

```typescript
import { createDashboardServer } from '@ai-agent-ledger/sdk/server'

const server = createDashboardServer(ledger)
await server.listen({ port: 4000 })

// REST API:
// GET  /runs/:run_id          — list all entries for a run
// GET  /runs/:run_id/verify   — re-compute SHA-256 chain, returns { valid, broken_at }
// POST /runs/:run_id/kill     — kill switch via HTTP
// GET  /export/:run_id        — download audit log as JSON or plain text
// WebSocket /                 — live stream of entry, kill, and escalation events
```

---

## 🧠 Enterprise Policy Engine

AgentLedger is Open-Core. The MIT SDK is the execution engine — free forever. The upcoming **`@ai-agent-ledger/policy-engine`** adds:

*   **Natural Language → Policy AST:** Write policies in plain English; they compile once at startup using Claude, Gemini, or OpenAI. Zero LLM calls at runtime.
*   **Slack / Teams / PagerDuty Escalation:** Approval gate workflows with native integrations and configurable timeout.
*   **100+ Governance Templates:** Pre-built policies for Fintech, Healthcare (HIPAA), and Legal use cases.

*[Request early access →](https://github.com/Esammy/AgentLedgerSDK/issues/new?template=feature_request.md&title=Enterprise+access+request)*

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Esammy/AgentLedgerSDK&type=Date)](https://star-history.com/#Esammy/AgentLedgerSDK&Date)

---

## Project Structure

```
src/
  ledger/      — AgentLedger core, SHA-256 chain, run context (AsyncLocalStorage)
  interceptor/ — Tool wrapping, policy evaluation, kill switch, approval gates
  policy/      — PolicyEngine, rule evaluator, built-in templates
  risk/        — Heuristic risk scorer and PII/credential classifier
  storage/     — Pluggable adapters: File (NDJSON), Memory, Cloud WebSocket
  server/      — Lightweight Node http + WebSocket dashboard server
examples/
  basic_usage.ts            — Quickstart: block + allow
  concurrency_and_runs.ts   — Request-scoped run isolation
  langchain_integration.ts  — LangChain tool wrapping
  anthropic_integration.ts  — Anthropic Claude tool use
  openai_integration.ts     — Raw OpenAI function calling
```

> **S3 storage** requires the separate `@ai-agent-ledger/s3` package.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for local setup, test commands, and how to propose new policy templates.

## License

MIT © [AgentLedger](https://github.com/Esammy/AgentLedgerSDK)
