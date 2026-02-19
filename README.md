# obsidian-curator

**Manage your Obsidian vault from the terminal. AI-enhanced, AI-optional.**

[![npm version](https://img.shields.io/npm/v/obsidian-curator.svg)](https://www.npmjs.com/package/obsidian-curator)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

---

## What it does

obsidian-curator connects directly to the CouchDB database that powers [Obsidian LiveSync](https://github.com/vrtmrz/obsidian-livesync), letting you capture notes, process them with AI, file them into the right folders, manage tasks, and keep your vault tidy — all from the command line or your own Node.js scripts.

**No AI? No problem.** Capture, audit, tidy, and task features all work rule-based without any API key.

---

## Features

| Feature | Command | AI required? |
|---------|---------|-------------|
| Quick capture to inbox | `capture` | No |
| Enrich inbox notes with tags/summary | `process` | **Yes** |
| Route notes to canonical folders | `file` | **Yes** |
| Check vault structure | `audit` | No |
| Clean up duplicates, dead notes | `tidy` | Optional (triage) |
| List and create tasks | `tasks`, `task` | No |
| Mark tasks complete | `done` | No |

---

## Requirements

- **Node.js 18+**
- **CouchDB** (local or remote) configured for Obsidian [LiveSync](https://github.com/vrtmrz/obsidian-livesync)
- The **Obsidian LiveSync plugin** installed and connected to that CouchDB instance

E2EE (end-to-end encryption) must be **disabled** — obsidian-curator reads document content directly from CouchDB.

---

## Quick Start

### 1. Install

```bash
npm install -g obsidian-curator
```

### 2. Run the setup wizard

```bash
obsidian-curator init
```

The wizard walks you through:
1. CouchDB connection (host, port, database, credentials) — tests the connection live
2. Vault structure preset (PARA / Zettelkasten / Johnny Decimal / Flat / Custom)
3. AI provider (OpenAI / Anthropic / Ollama / None)
4. Task projects (optional)

Config is saved to `~/.obsidian-curator/config.json`.

### 3. Capture your first note

```bash
obsidian-curator capture "Check out the new Obsidian graph view features"
# ✓ Captured to inbox/check-out-the-new-20260219-143022.md
```

### 4. Process inbox (with AI)

```bash
obsidian-curator process
# Processing 3 inbox notes...
# ✓ check-out-the-new.md — tagged: [obsidian, productivity], folder: Resources
# ✓ meeting-notes.md — tagged: [work, meetings], folder: Projects
# Done. 3 processed, 0 skipped.
```

### 5. File to vault

```bash
obsidian-curator file
# Filing 3 processed notes...
# ✓ check-out-the-new.md → Resources/Obsidian/check-out-the-new.md (confidence: 0.91)
# Done. 3 filed.
```

---

## CLI Command Reference

### `init`

Interactive setup wizard.

```bash
obsidian-curator init
```

---

### `capture`

Capture text to your inbox with a timestamp.

```bash
obsidian-curator capture "Note text here"
obsidian-curator capture "Ideas for the project" --source meeting
```

**Options:**
- `--source <label>` — tag the source (default: `cli`)

---

### `process`

Enrich inbox notes with AI-generated frontmatter (tags, summary, suggested folder).

```bash
obsidian-curator process
obsidian-curator process --limit 5
obsidian-curator process --dry-run
obsidian-curator process --force          # re-process already-processed notes
```

**Options:**
- `--limit <n>` — max notes to process (default: 10)
- `--dry-run` — show what would happen without writing
- `--force` — re-process notes that already have AI suggestions

**Requires AI provider** (not `none`).

---

### `file`

Route processed inbox notes to their canonical folders.

```bash
obsidian-curator file
obsidian-curator file --limit 5
obsidian-curator file --dry-run
obsidian-curator file --min-confidence 0.8
```

**Options:**
- `--limit <n>` — max notes to file (default: 10)
- `--dry-run` — preview without moving
- `--min-confidence <0-1>` — minimum AI confidence to auto-file (default: 0.7)

**Requires AI provider** (not `none`).

---

### `audit`

Check vault structure against your configured canonical folders.

```bash
obsidian-curator audit
```

**Example output:**
```
Vault Structure Audit
─────────────────────
✓ 142 notes in canonical locations
⚠  3 notes at vault root (not in rootExceptions)
⚠  1 non-canonical top-level folder: "Dump"
ℹ  Detected methodology: PARA
```

---

### `tidy`

Vault housekeeping — find duplicates, structure violations, dead notes.

```bash
obsidian-curator tidy
obsidian-curator tidy --dry-run
obsidian-curator tidy --checks dupes,stubs
```

**Options:**
- `--dry-run` — report issues without fixing anything
- `--checks <list>` — comma-separated: `dupes`, `structure`, `stubs`, or `all` (default: `all`)

**Works without AI** — ambiguous cases are flagged for manual review. **With AI**, ambiguous cases are triaged automatically.

---

### `tasks`

List open tasks.

```bash
obsidian-curator tasks
obsidian-curator tasks --project Work
obsidian-curator tasks --priority high
obsidian-curator tasks --status done
```

**Options:**
- `--project <name>` — filter by project
- `--priority high|normal|low` — filter by priority
- `--status open|done` — filter by status (default: open)

---

### `task`

Create a task from natural language.

```bash
obsidian-curator task "call dentist next Tuesday"
obsidian-curator task "urgent: submit invoice before March 1st"
obsidian-curator task "write project proposal for Work in 2 weeks"
```

The parser understands:
- **Relative dates:** "tomorrow", "next Tuesday", "in 2 weeks", "before March 1st"
- **Priority:** "urgent", "asap", "important" → high; "no rush", "whenever" → low
- **Projects:** matched from your configured keyword lists

---

### `done`

Mark a task complete.

```bash
obsidian-curator done "dentist"        # partial title match
obsidian-curator done "Tasks/call-dentist-next-tuesday.md"  # exact path
```

---

### `config`

View or update configuration.

```bash
obsidian-curator config show
obsidian-curator config set ai.provider openai
obsidian-curator config set ai.apiKey sk-...
obsidian-curator config set vault.host 192.168.1.100
```

---

## Programmatic API

```js
const { VaultClient, Curator, createAIAdapter, loadConfig } = require('obsidian-curator');

// Load config (searches ~/.obsidian-curator/config.json and .obsidian-curator.json)
const config = loadConfig();

// Or use a specific file:
// const config = loadConfig('/path/to/config.json');

// Connect to vault
const vault = new VaultClient(config.vault);
await vault.ping(); // throws if unreachable

// Set up AI (uses config.ai.provider)
const ai = createAIAdapter(config);

// Create curator
const curator = new Curator({ vault, ai, config });

// Capture a note
const path = await curator.capture('Quick thought about project X');
console.log('Saved to', path);

// Process inbox
const result = await curator.process({ limit: 5 });
console.log(result); // { processed: 5, skipped: 0, errors: [] }

// File notes
await curator.file({ dryRun: true });

// Create a task
const task = await curator.createTask('call Alice next Friday');
console.log(task.title, task.due, task.project);

// List tasks
const tasks = await curator.tasks({ status: 'open', project: 'Work' });

// Task brief (markdown summary)
const brief = await curator.taskBrief();
console.log(brief);

// Audit vault structure
const report = await curator.audit();

// Tidy vault
await curator.tidy({ checks: ['dupes', 'stubs'], dryRun: true });
```

---

## AI Provider Setup

| Provider | Cost | Privacy | Best for |
|----------|------|---------|---------|
| `none` | Free | Local | Rule-based features only |
| `ollama` | Free | Local | Full features, private |
| `openai` | Pay-per-use | Cloud | Best quality (GPT-4o-mini default) |
| `anthropic` | Pay-per-use | Cloud | High quality (Haiku default) |
| `custom` | Varies | Varies | OpenRouter, LM Studio, etc. |

See **[docs/AI-PROVIDERS.md](docs/AI-PROVIDERS.md)** for full setup instructions and cost estimates.

### Quick examples

**No AI (rule-based only):**
```json
{ "ai": { "provider": "none" } }
```

**Ollama (local, free):**
```json
{ "ai": { "provider": "ollama", "model": "llama3.2" } }
```

**OpenAI:**
```json
{ "ai": { "provider": "openai", "apiKey": "sk-...", "model": "gpt-4o-mini" } }
```

**Anthropic:**
```json
{ "ai": { "provider": "anthropic", "apiKey": "sk-ant-...", "model": "claude-haiku-4-5" } }
```

**OpenRouter (OpenAI-compatible):**
```json
{
  "ai": {
    "provider": "openai",
    "apiKey": "sk-or-...",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "anthropic/claude-haiku-4-5"
  }
}
```

---

## Vault Structure Presets

Choose a preset with `obsidian-curator init` or set `structure.preset` in config.

### PARA
```
inbox/          ← new captures land here
Projects/       ← active projects
Areas/          ← ongoing responsibilities
Resources/      ← reference material
Archives/       ← completed/inactive
```

### Zettelkasten
```
inbox/          ← fleeting notes
Slipbox/        ← permanent atomic notes
References/     ← literature notes
Projects/       ← project-specific work
Archives/       ← inactive
```

### Johnny Decimal
```
inbox/          ← new captures
00-09/          ← Meta (user-defined)
10-19/          ← (user-defined)
...
```

### Flat
```
inbox/          ← everything starts here
(everything else at root — no enforced structure)
```

---

## Configuration Reference

Config is stored at `~/.obsidian-curator/config.json` (global) or `.obsidian-curator.json` (project-local). Local overrides global.

```json
{
  "vault": {
    "host": "localhost",        // CouchDB hostname or IP
    "port": 5984,               // CouchDB port
    "database": "obsidian",     // CouchDB database name
    "username": "",             // CouchDB username (leave blank if no auth)
    "password": "",             // CouchDB password
    "protocol": "http"          // "http" or "https"
  },

  "structure": {
    "preset": "para",           // "para" | "zettelkasten" | "johnny-decimal" | "flat" | "custom"
    "folders": {
      "inbox": "inbox",         // Override preset folder names
      "projects": "Projects"
    },
    "customFolders": [],        // Additional canonical top-level folders
    "rootExceptions": [         // Files allowed at vault root
      "Index.md", "Welcome.md", "README.md"
    ],
    "systemPaths": [            // Paths to never touch
      "logs/", "ix:"
    ]
  },

  "ai": {
    "provider": "none",         // "none" | "openai" | "anthropic" | "ollama" | "custom"
    "model": null,              // Model name (provider default if null)
    "apiKey": null,             // API key
    "baseUrl": null             // Custom base URL (OpenAI-compatible)
  },

  "tasks": {
    "folder": "Tasks",          // Vault folder for task notes
    "projects": {               // Keyword → project mapping
      "Work": ["work", "office", "meeting", "invoice", "client"],
      "Home": ["house", "garden", "clean", "fix", "repair"]
    },
    "defaultPriority": "normal"
  },

  "tidy": {
    "autoDeleteConfidence": 0.8,  // Confidence threshold for auto-delete (0-1)
    "testPatterns": [             // Filename patterns to auto-delete
      "test-*", "Test*", "Untitled*"
    ],
    "protectedPaths": [],         // Paths that tidy will never touch
    "maxAutoActions": 50          // Safety cap on automatic changes per run
  }
}
```

---

## Setup Guide

See **[docs/SETUP.md](docs/SETUP.md)** for detailed CouchDB setup, LiveSync configuration, and troubleshooting.

---

## API Reference

See **[docs/API.md](docs/API.md)** for the full programmatic API.

---

## Contributing

PRs and issues welcome at [github.com/philmossman/obsidian-curator](https://github.com/philmossman/obsidian-curator).

This project follows a "practical first" philosophy: no TypeScript, no bundler, plain CJS Node.js. Keep dependencies minimal.

```bash
git clone https://github.com/philmossman/obsidian-curator.git
cd obsidian-curator
npm install
npm test
```

---

## License

MIT © Phil Mossman
