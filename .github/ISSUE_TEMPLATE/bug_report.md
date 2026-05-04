---
name: Bug Report
about: Something is broken or behaving unexpectedly
title: '[Bug]: '
labels: bug
assignees: ''
---

## Describe the Bug

A clear and concise description of what the bug is.

## Minimal Reproduction

```typescript
// Paste the smallest possible code snippet that reproduces the issue
import { AgentLedger } from '@ai-agent-ledger/sdk'

const ledger = new AgentLedger({ ... })
// ...
```

## Expected Behavior

What did you expect to happen?

## Actual Behavior

What actually happened? Include any error messages or stack traces.

```
paste error or console output here
```

## Environment

- **SDK version:** (run `npm list @ai-agent-ledger/sdk`)
- **Node.js version:** (run `node --version`)
- **OS:** (e.g. macOS 14, Ubuntu 22.04, Windows 11)
- **Agent framework:** (e.g. LangChain, Anthropic, raw OpenAI, custom)

## Additional Context

Any other information that might be relevant (storage adapter, policy config, etc.).
