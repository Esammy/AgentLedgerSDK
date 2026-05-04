---
name: Feature Request
about: Propose a new feature, policy template, or storage adapter
title: '[Feature]: '
labels: enhancement
assignees: ''
---

## What problem does this solve?

Describe the real-world scenario or pain point. The more specific, the better.
Example: *"When running agents in a healthcare setting, I need to block any tool that writes unencrypted PII to disk."*

## Proposed Solution

Describe what you'd like to see. If you have a specific API in mind, sketch it out:

```typescript
// Example of how you'd want to use it
POLICY_TEMPLATES.pii_disk_write_block()
```

## Alternatives Considered

Have you found any workarounds using the current SDK? What are their limitations?

## Is This OSS Core or Enterprise?

- [ ] OSS Core (should be in the MIT SDK — deterministic, no external dependencies)
- [ ] Enterprise (requires LLM compiler, external integrations, or paid infrastructure)
- [ ] Not sure

## Additional Context

Screenshots, links to similar tools, or any other relevant context.
