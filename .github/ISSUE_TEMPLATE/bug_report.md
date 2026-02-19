---
name: Bug Report
about: Something isn't working as expected
title: ''
labels: bug
assignees: ''
---

## Describe the bug

A clear description of what's going wrong.

## Steps to reproduce

1. Run `obsidian-curator ...`
2. ...

## Expected behaviour

What should have happened.

## Actual behaviour

What actually happened. Include error messages if any.

## Environment

- **obsidian-curator version:** (run `obsidian-curator --version`)
- **Node.js version:** (run `node --version`)
- **OS:** (e.g. macOS 15, Ubuntu 24.04)
- **CouchDB version:** 
- **AI provider:** (none / openai / anthropic / ollama / custom)

## Config (redact credentials)

```json
{
  "vault": { "host": "...", "port": 5984, "database": "..." },
  "ai": { "provider": "..." },
  "structure": { "preset": "..." }
}
```

## Additional context

Any other relevant info, screenshots, or logs.
