# AgentLedger SDK 🛡️⛓️
**Runtime Trust & Observability Infrastructure for AI Agents**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![NPM Version](https://img.shields.io/npm/v/@ai-agent-ledger/sdk)](https://www.npmjs.com/package/@ai-agent-ledger/sdk)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-blue)](https://www.typescriptlang.org/)

AgentLedger is a thin middleware SDK that makes enterprise AI agents auditable, controllable, and compliant. Unlike tracing tools that only show you what happened, AgentLedger enforces what *can* happen in real-time and produces cryptographically verifiable audit evidence.

### [3-Line Install] → [Full Governance]
Wrap any AI agent framework (LangChain, CrewAI, AutoGen, or custom) in 3 lines of code. Captured events are stored in a tamper-evident SHA-256 hash chain.

---

## 🚀 Quickstart

### 1. Install
```bash
npm install @ai-agent-ledger/sdk
```

### 2. Wrap and Govern
```typescript
import { AgentLedger, POLICY_TEMPLATES } from '@ai-agent-ledger/sdk'

const ledger = new AgentLedger({
  agent_id: 'payment-bot-prod',
  storage: { type: 'file', path: './audit-ledger.ndjson' },
  policies: [
    POLICY_TEMPLATES.no_spend_over(500),   // Real-time block
    POLICY_TEMPLATES.no_delete(),          // Prevents destructive tool calls
    POLICY_TEMPLATES.external_email_gate('corp.com') // Approval gate for external emails
  ]
})

// Wrap any agent object that has a 'tools' array
const agent = ledger.wrap(myExistingAgent)

// Every tool call is now governed, risk-scored, and hashed
```

---

## ✨ Key Features

*   **🛡️ Policy Enforcement:** Enforce deterministic, rule-based policies at the tool-call level (Block or Approve-Gate).
*   **⛓️ Tamper-Evident Ledger:** Every event is part of a SHA-256 hash chain. Any retroactive modification to the audit log invalidates the subsequent hashes.
*   **🛑 Kill Switch:** Programmatically halt agent execution across all or specific runs. The kill switch is checked synchronously *before* the next tool invocation begins.
*   **🔍 Risk Scoring:** Automated 0-100 risk scoring based on tool names, arguments (PII/Credentials detection), and outputs.
*   **🤖 Framework Agnostic:** Works with LangChain, CrewAI, Anthropic API, or your own custom agent logic.

---

## 🧠 Enterprise Policy Engine (Coming Soon)

AgentLedger uses an Open-Core model. The MIT SDK provides the foundational execution engine, while advanced features live in the upcoming `@ai-agent-ledger/policy-engine` enterprise package:

*   **Natural Language Compilers:** Translate plain English ("Never allow querying production databases with a LIMIT greater than 1000") directly into deterministic AST rules using Claude, Gemini, or OpenAI.
*   **Approval Gate Workflows:** Native integration with Slack, Microsoft Teams, and PagerDuty for human-in-the-loop approvals.
*   **100+ Policy Templates:** Pre-built governance policies for Fintech, Healthcare, and Legal use cases.

*To get early access to the Enterprise Policy Engine, please reach out to the team.*

---

## 🧵 Request-Scoped Concurrency

In multi-user server environments (e.g., Fastify or Express), use `ledger.run()` to isolate audit trails via `AsyncLocalStorage`, preventing `run_id` state leakage between concurrent async requests in a single Node.js process.

```typescript
// Returns a Promise when the callback is async — be sure to await it
await ledger.run(async () => {
  // All tool calls inside this block share a unique run_id
  await agent.invoke({ input: "Pay invoice #123" })
}, 'request-user-456')
```

---

## 📊 Trust Dashboard (`@ai-agent-ledger/sdk/server`)

AgentLedger includes an optional lightweight Node `http` server to power a live trust dashboard, handle human approvals, and export audit reports.

```typescript
import { createDashboardServer } from '@ai-agent-ledger/sdk/server'

const server = createDashboardServer(ledger)
await server.listen({ port: 4000 })
```

---

## 📂 Project Structure

*   `src/ledger`: Core AgentLedger logic and SHA-256 chaining.
*   `src/interceptor`: Zero-overhead tool and LLM wrapping.
*   `src/policy`: Deterministic policy engine execution and templates.
*   `src/risk`: Heuristic risk scoring and PII detection.
*   `src/storage`: Pluggable adapters (File, Memory, Cloud. Note: S3 requires the separate `@ai-agent-ledger/s3` package).

## 📄 License

MIT © [AgentLedger](https://github.com/Esammy/AgentLedgerSDK)
