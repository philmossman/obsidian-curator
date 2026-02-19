# Contributing to obsidian-curator

Thanks for your interest! Here's how to get involved.

## Getting started

```bash
git clone https://github.com/philmossman/obsidian-curator.git
cd obsidian-curator
npm install
npm test
```

## Development guidelines

- **No external dependencies** for the CLI layer (readline, fs, path, os only)
- **CJS** (`require`/`module.exports`) — no TypeScript
- **JSDoc** type annotations on all public methods
- **Config-driven** — no hardcoded paths, folder names, or user-specific values
- **AI adapter** — all AI calls go through the adapter interface, never direct API calls
- **Tests** — add tests for new features using the existing assert pattern (no test frameworks)

## Making changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `npm test` — all 96+ tests must pass
4. Submit a PR with a clear description

## What we're looking for

- Bug fixes (always welcome)
- New AI adapter implementations
- New vault structure presets
- Improved date parsing in the task parser
- Documentation improvements
- Performance improvements for large vaults

## What to avoid

- Adding external dependencies without strong justification
- TypeScript migration (planned for v2, not v1)
- Breaking changes to the public API or config schema
- Features that only work with a specific AI provider

## Code style

Keep it readable. No linter is configured — just match the existing style:
- 2-space indentation
- Single quotes for strings
- Descriptive variable names
- Comments for "why", not "what"

## Questions?

Open an issue with the question label, or start a discussion.
