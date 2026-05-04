# Contributing to AgentLedger SDK

Thank you for your interest in contributing! AgentLedger is an open-core project — the MIT SDK is community-driven. Here's everything you need to get started.

---

## Table of Contents

- [Local Setup](#local-setup)
- [Running Tests](#running-tests)
- [Code Style](#code-style)
- [Proposing Policy Templates](#proposing-policy-templates)
- [Pull Request Process](#pull-request-process)
- [Reporting Bugs](#reporting-bugs)

---

## Local Setup

```bash
# 1. Clone the repo
git clone https://github.com/Esammy/AgentLedgerSDK.git
cd AgentLedgerSDK

# 2. Install dependencies
npm install

# 3. Copy env file (no API keys needed for OSS core tests)
cp .env.example .env

# 4. Type-check the project
npm run typecheck

# 5. Run the test suite
npm test
```

**Requirements:** Node.js ≥ 18, npm ≥ 9.

---

## Running Tests

```bash
# Run all tests once
npm test

# Watch mode (re-runs on file save)
npm run test:watch

# Type-check only (no test execution)
npm run typecheck

# Run a specific example to see live output
npx tsx examples/basic_usage.ts
npx tsx examples/concurrency_and_runs.ts
```

All tests in `tests/` use [Vitest](https://vitest.dev/). The core test suite runs without any API keys.

---

## Code Style

- **TypeScript strict mode** is on (`strict: true` in `tsconfig.json`). No `any` without a comment explaining why.
- **No external runtime dependencies** — the OSS core has zero production dependencies. Keeping it this way is a deliberate design goal.
- **Fail-open by design** — if AgentLedger itself throws, the agent should continue (unobserved) rather than crash. Don't break this invariant.
- Prefer `const` over `let`. Use `unknown` over `any`. Use type guards over casts.
- New files should export exactly what they need — avoid barrel re-exports that pull in compiler internals.

---

## Proposing Policy Templates

Built-in policy templates live in [`src/policy/templates.ts`](./src/policy/templates.ts). A good template:

1. **Has a real use case** — e.g. "block all tool calls outside business hours" is a common compliance requirement.
2. **Uses only the existing `RuleCondition` types** (`tool_match`, `arg_gt`, `arg_contains`, `time_after`, `time_before`, `always`).
3. **Is tested** — add at least one test case in `tests/concurrency.test.ts` or a new test file.
4. **Has a JSDoc comment** describing what it blocks and any parameters.

Open a [Feature Request](https://github.com/Esammy/AgentLedgerSDK/issues/new?template=feature_request.md) before writing code for a new template, so we can align on the interface.

---

## Pull Request Process

1. **Fork** the repo and create a branch from `main`: `git checkout -b feat/my-feature`.
2. **Make your changes** and add or update tests.
3. Run `npm run typecheck && npm test` — both must pass.
4. **Open a PR** against `main` with a clear title and description.
5. Reference any related issue with `Closes #123`.
6. A maintainer will review within 48 hours.

**PR title format:**
```
feat: add business_hours_only policy template
fix: handle undefined tool output in risk scorer
docs: add CrewAI integration example
chore: bump vitest to 2.x
```

---

## Reporting Bugs

Use the [Bug Report template](https://github.com/Esammy/AgentLedgerSDK/issues/new?template=bug_report.md). Please include:
- Your SDK version (`npm list @ai-agent-ledger/sdk`)
- Your Node.js version (`node --version`)
- A minimal reproducible code snippet
- What you expected vs. what happened

---

## Questions?

Open a [GitHub Discussion](https://github.com/Esammy/AgentLedgerSDK/discussions) for general questions. Issues are for bugs and feature requests only.
