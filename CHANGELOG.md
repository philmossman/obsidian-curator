# Changelog

All notable changes to this project will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] — 2026-02-19

Initial release.

### Added

**Core library**
- `VaultClient` — CouchDB/LiveSync CRUD operations (list, read, write, delete, move, search, parseFrontmatter, buildNote)
- LiveSync-compatible soft-delete (sets `deleted: true`, clears content and children)
- Content-addressed chunked storage compatible with Obsidian LiveSync format
- Unicode sanitization for vault writes
- Friendly CouchDB error messages (ECONNREFUSED, auth failures, missing database)

**Configuration system**
- `loadConfig()` — merges defaults → global config → local config → explicit path
- Four built-in structure presets: PARA, Zettelkasten, Johnny Decimal, Flat
- `validateConfig()` — schema validation with descriptive error messages
- Config helpers: `getCanonicalFolders()`, `getSystemPaths()`, `getRootExceptions()`

**AI adapter layer**
- `createAIAdapter()` — factory returning the right adapter from config
- `NoneAdapter` — rule-based only, no AI calls
- `OpenAIAdapter` — OpenAI chat completions API (also works with OpenRouter, LM Studio, custom endpoints)
- `AnthropicAdapter` — Anthropic Messages API
- `OllamaAdapter` — Ollama local inference API
- Shared adapter interface: `complete(prompt)` and `structured(prompt, schema)`

**Capture** (no AI)
- Quick capture to configured inbox folder
- Timestamp-based filename generation
- Source tagging in frontmatter

**Process** (requires AI)
- Inbox note enrichment: tags, one-line summary, suggested destination folder
- Respects `--limit`, `--dry-run`, `--force` options
- Writes `ai_suggestions` frontmatter block to enriched notes

**File** (requires AI)
- Routes processed inbox notes to canonical vault folders
- Configurable confidence threshold
- Session-based undo tracking
- Supports `--limit`, `--dry-run`, `--min-confidence`

**Audit** (no AI)
- Structure analysis against canonical folder config
- Misplaced note detection
- Non-canonical folder detection
- Root violation detection (notes at vault root)
- Vault methodology detection (PARA, Zettelkasten, Johnny Decimal)

**Tidy** (AI optional)
- Duplicate detection: exact duplicates (same name + size) auto-resolved; ambiguous cases flagged
- Structure enforcement: root-level notes flagged or routed
- Dead note cleaning: 0-byte and test-pattern files auto-deleted
- Stub detection: tiny notes (<300 bytes, not in inbox) flagged or AI-triaged
- `--dry-run` mode, configurable confidence thresholds, auto-action limits
- Protected paths never touched

**Task system** (no AI)
- `parseTask()` — natural language → structured task (title, due date, project, priority)
- Relative date parsing: "tomorrow", "next Tuesday", "in 2 weeks", "before March 1st", etc.
- Priority detection: urgent/asap/important → high; no rush/whenever → low
- Project matching via configurable keyword lists
- `TaskStore` — CRUD: createTask, listTasks, completeTask
- Task notes stored as Obsidian markdown with YAML frontmatter
- `generateTaskBrief()` — overdue/due-soon/open count summary

**CLI**
- `obsidian-curator init` — interactive setup wizard (CouchDB, structure, AI, tasks)
- `obsidian-curator capture <text>` — quick inbox capture
- `obsidian-curator process` — AI inbox enrichment
- `obsidian-curator file` — AI note routing
- `obsidian-curator audit` — structure audit
- `obsidian-curator tidy` — vault housekeeping
- `obsidian-curator tasks` — list tasks
- `obsidian-curator task <text>` — create task from natural language
- `obsidian-curator done <search>` — complete task
- `obsidian-curator config show` — view current config
- `obsidian-curator config set <key> <value>` — update config
- Coloured terminal output with status indicators

**Tests**
- 96 unit tests covering vault client, config, AI adapters, auditor, processor, task parser, tidy scanner, CLI

[0.1.0]: https://github.com/openclaw/obsidian-curator/releases/tag/v0.1.0
