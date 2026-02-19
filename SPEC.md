# obsidian-curator — Product Spec v1.0

**Status:** Approved
**Date:** 2026-02-19
**Authors:** Phil Mossman + Kryten

---

## Vision

A standalone Node.js library and CLI for managing Obsidian vaults via LiveSync CouchDB. AI-enhanced but AI-optional — rule-based features work without any API keys, smart features work with whatever AI provider the user has.

Optional OpenClaw skill wrapper for users running OpenClaw agents.

---

## Package Identity

- **npm package:** `obsidian-curator`
- **ClawHub skill:** `obsidian-curator`
- **Repository:** `github.com/openclaw/obsidian-curator` (public)
- **License:** MIT

---

## Architecture

Three layers, each usable independently:

```
┌──────────────────────────────────┐
│  OpenClaw Skill (ClawHub)        │  Telegram commands, heartbeat integration,
│                                  │  distill (memory → vault), OpenClaw AI client
├──────────────────────────────────┤
│  CLI                             │  obsidian-curator capture/process/tidy/tasks/audit
│                                  │  Interactive setup wizard, config management
├──────────────────────────────────┤
│  Core Library                    │  vault-client, scanner, parser, filer,
│                                  │  AI adapter interface, structure templates
└──────────────────────────────────┘
```

### Core Library

The programmatic API. No opinions about how you interact with it.

```js
const { VaultClient, Curator } = require('obsidian-curator');

const vault = new VaultClient({ host, port, database, username, password });
const curator = new Curator({ vault, ai, config });

await curator.capture('Quick thought about project X');
await curator.process({ limit: 5 });
await curator.tidy({ checks: ['dupes', 'stubs'] });
```

### CLI

Wraps the core library for terminal use.

```bash
obsidian-curator init              # interactive setup wizard
obsidian-curator capture "note"    # quick capture to inbox
obsidian-curator process           # process inbox notes
obsidian-curator file              # AI-powered filing
obsidian-curator tidy              # vault housekeeping
obsidian-curator tidy --dry-run    # preview without changes
obsidian-curator tasks             # list open tasks
obsidian-curator task "do X by Friday"  # create task
obsidian-curator done "X"          # complete task
obsidian-curator audit             # structure audit
obsidian-curator config show       # show current config
obsidian-curator config set <key> <value>
```

### OpenClaw Skill

Thin wrapper providing Telegram command handlers and OpenClaw-specific features (distill, heartbeat task briefing). Published separately to ClawHub.

---

## Configuration

All behaviour driven by a single config file (`~/.obsidian-curator/config.json` or project-local `.obsidian-curator.json`).

### Connection

```json
{
  "vault": {
    "host": "localhost",
    "port": 5984,
    "database": "obsidian",
    "username": "",
    "password": "",
    "protocol": "http"
  }
}
```

### Vault Structure

Users pick a preset or define custom. Presets are starting points, always editable.

```json
{
  "structure": {
    "preset": "para",
    "folders": {
      "inbox": "inbox",
      "projects": "Projects",
      "areas": "Areas",
      "resources": "Resources",
      "archive": "Archives"
    },
    "customFolders": ["Photography", "Research", "Slipbox"],
    "rootExceptions": ["Index.md", "Welcome.md", "README.md"],
    "systemPaths": ["logs/", "ix:*"]
  }
}
```

**Built-in presets:**

| Preset | Folders |
|--------|---------|
| `para` | inbox, Projects, Areas, Resources, Archives |
| `zettelkasten` | inbox, Slipbox, References, Projects, Archives |
| `johnny-decimal` | 00-09 Meta, 10-19 Projects, ... (user defines) |
| `flat` | inbox only — everything else at root |
| `custom` | User defines all folders from scratch |

### AI Provider

```json
{
  "ai": {
    "provider": "none",
    "model": null,
    "apiKey": null,
    "baseUrl": null
  }
}
```

**Supported providers:**

| Provider | Config | Notes |
|----------|--------|-------|
| `none` | No config needed | Rule-based only, no AI features |
| `openai` | `apiKey`, optional `model` (default: `gpt-4o-mini`), optional `baseUrl` | Works with any OpenAI-compatible API |
| `anthropic` | `apiKey`, optional `model` (default: `claude-haiku-4-5`) | |
| `ollama` | optional `baseUrl` (default: `http://localhost:11434`), `model` | Free, local, private |
| `openclaw` | No config needed (uses OpenClaw's AI client) | Only available inside OpenClaw skill |
| `custom` | `baseUrl`, `apiKey`, `model` | Any OpenAI-compatible endpoint |

The adapter interface is simple enough that adding providers is trivial:

```js
class AIAdapter {
  async complete(prompt, options = {}) → string
  async structured(prompt, schema, options = {}) → object
}
```

### Task System

```json
{
  "tasks": {
    "folder": "Tasks",
    "projects": {
      "Photography": ["photo", "photos", "photography", "portfolio", "lightroom"],
      "Work": ["work", "office", "meeting", "invoice", "client", "contract"],
      "Home": ["house", "garden", "clean", "fix", "repair"]
    },
    "defaultPriority": "normal"
  }
}
```

Users define their own project keywords. The parser uses these for auto-detection.

### Tidy Rules

```json
{
  "tidy": {
    "autoDeleteConfidence": 0.8,
    "testPatterns": ["test-*", "Test*", "Untitled*"],
    "protectedPaths": [],
    "maxAutoActions": 50
  }
}
```

---

## Feature Breakdown

### 1. Vault Client (Core)

CouchDB/LiveSync CRUD operations. The foundation everything else builds on.

- `listNotes()` — list all vault notes with metadata
- `readNote(path)` — read note content
- `writeNote(path, content)` — create or update note
- `deleteNote(path)` — delete note
- `moveNote(from, to)` — move/rename note
- `searchNotes(query)` — basic text search
- `parseFrontmatter(content)` — extract YAML frontmatter
- `buildNote(frontmatter, body)` — construct note with frontmatter

**No AI required.** This is pure CouchDB interaction.

### 2. Capture

Quick capture to inbox folder. Adds timestamp frontmatter.

- Input: raw text
- Output: note in inbox with `created` timestamp
- **No AI required.**

### 3. Process (AI)

Reads inbox notes and enriches them with frontmatter (tags, summary, suggested folder).

- Reads raw inbox note
- AI generates: title cleanup, tags, summary, suggested destination folder
- Writes enriched note back (still in inbox — filing is separate)
- **Requires AI.** Without AI, this is a no-op (or just adds timestamp frontmatter).

### 4. File (AI)

Routes processed notes from inbox to their correct folder based on content analysis.

- Reads enriched note + vault structure
- AI decides destination folder + reasoning
- Moves note, updates any internal links
- Supports undo (session-based)
- **Requires AI.** Without AI, user must file manually (or use basic keyword matching as fallback).

### 5. Audit

Checks vault structure against configured canonical folders.

- Reports notes in wrong locations
- Reports non-canonical top-level folders
- Reports orphaned folders (empty)
- **No AI required.** Pure rule-based.

### 6. Tidy

Vault housekeeping — three sub-features:

**6a. Duplicate Cleaner**
- Same filename + same size → exact duplicate (auto-fix)
- Same filename + different size → AI triage or flag
- Respects folder context (README.md in different projects is intentional)

**6b. Structure Enforcer**
- Root-level notes → flag or auto-route
- Non-canonical folders → flag
- Test/throwaway at root → auto-delete (high confidence)

**6c. Dead Note Cleaner**
- 0-byte notes → auto-delete
- Test pattern filenames → auto-delete
- Tiny stubs (<300 bytes, not in inbox) → AI triage or flag

**All three work without AI** (rule-based mode flags instead of auto-resolving ambiguous cases). **With AI**, ambiguous cases get triaged automatically.

### 7. Task System

Natural language task capture with Obsidian-native storage.

- **Parser:** Extracts title, due date, priority, project from natural language
- **Store:** CRUD operations, tasks stored as markdown notes with frontmatter in configured Tasks folder
- **Briefing:** Summary generator (overdue, due soon, open count)
- Date parsing: "tomorrow", "next Tuesday", "before March 1st", "in 2 weeks", etc.
- Priority detection: "urgent", "asap", "important" → high; "no rush", "whenever" → low
- Project detection: configurable keyword matching
- **No AI required.** Fully rule-based.

---

## Setup Wizard

`obsidian-curator init` walks users through:

1. **CouchDB connection** — host, port, database, credentials. Tests connection.
2. **Structure preset** — pick PARA/Zettelkasten/Johnny Decimal/Flat/Custom. Preview folders.
3. **AI provider** — pick provider, enter API key, test with a simple prompt.
4. **Task projects** — define project names + keywords (or skip).
5. **Write config** — saves to `~/.obsidian-curator/config.json`.

---

## v1.0 Scope

### In Scope

| Feature | AI Required | Status in current codebase |
|---------|------------|---------------------------|
| Vault client | No | ✅ Built, generic |
| Capture | No | ✅ Built, generic |
| Process | Yes | ✅ Built, needs AI abstraction |
| File | Yes | ✅ Built, needs AI abstraction |
| Audit | No | ✅ Built, needs config-driven structure |
| Tidy | Optional | ✅ Built, needs config-driven structure |
| Task system | No | ✅ Built, needs config-driven projects |
| CLI | — | 🆕 New |
| Setup wizard | — | 🆕 New |
| AI adapter layer | — | 🆕 New |
| Config system | — | 🆕 New (partial exists) |

### Out of Scope (v1.0)

| Feature | Notes |
|---------|-------|
| Distill (memory → vault) | OpenClaw-specific. Research feasibility for other AI platforms post-v1. |
| Broken link detection | Low priority for young vaults |
| Tag consolidation | Future |
| Frontmatter standardisation | Future |
| Orphan/backlink graph | Future |
| Web UI | Future (if ever) |

### Future Research

- **Distill for non-OpenClaw:** Could work with any AI that has a memory/conversation export. Research whether ChatGPT, Copilot, or local LLM conversation logs could feed the distill pipeline. Not v1.0 but worth a design note in the architecture.

---

## Implementation Plan

### Phase 1: Foundation (Core Library)

Extract and genericise from existing codebase:

1. **Config system** — loader, validator, preset templates, schema
2. **AI adapter layer** — interface + OpenAI, Anthropic, Ollama, none adapters
3. **Vault client** — extract as standalone (already mostly generic)
4. **Refactor existing modules** — replace hardcoded values with config lookups

### Phase 2: CLI

1. **Setup wizard** — interactive `init` command
2. **Command routing** — capture, process, file, audit, tidy, tasks, done, config
3. **Output formatting** — terminal-friendly (colours, tables, spinners)

### Phase 3: Feature Genericisation

1. **Process + File** — wire through AI adapter, config-driven structure
2. **Tidy** — config-driven canonical folders, test patterns, thresholds
3. **Tasks** — config-driven project keywords
4. **Audit** — config-driven structure validation

### Phase 4: Polish & Publish

1. **Tests** — port existing tests, add integration tests with mock CouchDB
2. **Documentation** — README, API docs, examples
3. **npm publish** — `obsidian-curator`
4. **ClawHub skill** — thin wrapper, publish to ClawHub

---

## Repository Structure

```
obsidian-curator/
├── src/
│   ├── core/
│   │   ├── vault-client.js        # CouchDB CRUD
│   │   ├── config.js              # Config loader + validator
│   │   ├── curator.js             # Main orchestrator class
│   │   └── undo.js                # Undo session management
│   ├── ai/
│   │   ├── adapter.js             # Base adapter interface
│   │   ├── openai.js              # OpenAI/compatible adapter
│   │   ├── anthropic.js           # Anthropic adapter
│   │   ├── ollama.js              # Ollama adapter
│   │   └── prompts.js             # Shared prompt templates
│   ├── features/
│   │   ├── capture.js
│   │   ├── processor.js
│   │   ├── filer.js
│   │   ├── auditor.js
│   │   ├── tidy/
│   │   │   ├── scanner.js
│   │   │   ├── ai-triage.js
│   │   │   └── executor.js
│   │   └── tasks/
│   │       ├── parser.js
│   │       ├── store.js
│   │       └── briefing.js
│   ├── templates/
│   │   ├── para.json
│   │   ├── zettelkasten.json
│   │   ├── johnny-decimal.json
│   │   └── flat.json
│   └── cli/
│       ├── index.js               # CLI entry point
│       ├── wizard.js              # Setup wizard
│       └── commands/
│           ├── capture.js
│           ├── process.js
│           ├── file.js
│           ├── audit.js
│           ├── tidy.js
│           ├── tasks.js
│           └── config.js
├── test/
│   ├── unit/
│   └── integration/
├── docs/
│   ├── README.md
│   ├── SETUP.md
│   ├── AI-PROVIDERS.md
│   └── API.md
├── package.json
├── LICENSE
└── README.md
```

---

## Technical Decisions

1. **CJS with ESM wrapper.** Existing codebase is CJS — no rewrite. Add ESM entry point via package.json `"exports"` field.
2. **Plain JS with JSDoc types.** No TypeScript for v1. JSDoc annotations on public API for autocomplete/type hints. Revisit TS for v2 if demand warrants.
3. **Node 18+ minimum.** Current LTS floor. Anyone running LiveSync or OpenClaw will have this.
4. **Single package.** Core lib + CLI in one npm package. OpenClaw skill wrapper is a separate repo on ClawHub. Split to monorepo later if needed.
