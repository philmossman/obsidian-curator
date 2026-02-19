# API Reference

obsidian-curator is a Node.js library as well as a CLI. This document covers the programmatic API.

```js
const {
  VaultClient, Curator, createAIAdapter, loadConfig,
  Processor, Filer, StructureAuditor,
  TaskStore, parseTask, generateTaskBrief
} = require('obsidian-curator');
```

---

## `loadConfig([explicitPath], [options])`

Load, merge and validate configuration.

**Search order** (later wins):
1. Built-in defaults
2. `~/.obsidian-curator/config.json` (global)
3. `./.obsidian-curator.json` (local, current directory)
4. `explicitPath` (if provided)

**Parameters:**
- `explicitPath` `{string}` — Optional absolute path to a config file
- `options.validate` `{boolean}` — Run schema validation (default: `true`)

**Returns:** `{Object}` — Resolved, merged config object

**Throws:** If config files are malformed or validation fails.

```js
const config = loadConfig();
// or:
const config = loadConfig('/home/user/my-curator.json');
// or skip validation (useful for partial configs):
const config = loadConfig(null, { validate: false });
```

---

## `VaultClient`

CouchDB/LiveSync CRUD operations. The foundation everything builds on.

### Constructor

```js
const vault = new VaultClient({
  host: 'localhost',
  port: 5984,
  database: 'obsidian',
  username: 'admin',
  password: 'secret',
  protocol: 'http'   // or 'https'
});

// Or from config:
const vault = new VaultClient(config.vault);
```

### `vault.ping()`

Check CouchDB connectivity.

**Returns:** `Promise<{ ok: true }>`  
**Throws:** Friendly error if unreachable, auth fails, or database missing.

```js
await vault.ping(); // throws or returns { ok: true }
```

### `vault.listNotes()`

List all active notes (excludes chunks, deleted docs, system docs).

**Returns:** `Promise<Array<{ path: string, id: string, mtime: number, size: number }>>`

```js
const notes = await vault.listNotes();
// [ { path: 'inbox/my-note.md', id: 'inbox/my-note.md', mtime: 1708000000000, size: 512 }, ... ]
```

### `vault.readNote(path)`

Read a note by its vault path.

**Parameters:**
- `path` `{string}` — Note path, e.g. `'inbox/my-note.md'`

**Returns:** `Promise<{ path, content, ctime, mtime, metadata } | null>`  
Returns `null` if the note doesn't exist.

```js
const note = await vault.readNote('inbox/my-note.md');
if (note) {
  console.log(note.content);
  console.log(note.mtime);  // Unix timestamp
}
```

### `vault.writeNote(path, content, [options])`

Write or update a note. Creates it if it doesn't exist. Sanitizes dangerous Unicode control characters.

**Parameters:**
- `path` `{string}` — Note path
- `content` `{string}` — Full note content (Markdown)
- `options.type` `{string}` — Document type (default: `'plain'`)

**Returns:** `Promise<{ ok: true, id: string, rev: string }>`

```js
await vault.writeNote('inbox/hello.md', `---
title: Hello
created: 2026-02-19
---

Hello world!
`);
```

### `vault.deleteNote(path)`

Soft-delete a note (LiveSync-compatible). Sets `deleted: true`, clears content. Does not use `db.destroy()`.

**Parameters:**
- `path` `{string}` — Note path

**Returns:** `Promise<{ ok: true }>`

```js
await vault.deleteNote('inbox/old-note.md');
```

### `vault.moveNote(from, to)`

Move a note from one path to another. Writes the content to the new path, then soft-deletes the original.

**Parameters:**
- `from` `{string}` — Source path
- `to` `{string}` — Destination path

**Returns:** `Promise<{ ok: true }>`

```js
await vault.moveNote('inbox/my-note.md', 'Projects/ProjectX/my-note.md');
```

### `vault.searchNotes(query)`

Basic full-text search across note paths. Client-side filter over `listNotes()`.

**Parameters:**
- `query` `{string}` — Case-insensitive search string

**Returns:** `Promise<Array<{ path, id, mtime, size }>>`

```js
const results = await vault.searchNotes('project x');
```

### `vault.parseFrontmatter(content)`

Parse YAML frontmatter from note content. Handles nested objects and inline arrays.

**Parameters:**
- `content` `{string}` — Full note content

**Returns:** `{ frontmatter: Object, body: string }`

```js
const { frontmatter, body } = vault.parseFrontmatter(note.content);
console.log(frontmatter.tags); // ['work', 'planning']
console.log(body);             // Markdown body without frontmatter
```

### `vault.buildNote(frontmatter, body)`

Build complete note content from a frontmatter object and body string.

**Parameters:**
- `frontmatter` `{Object}` — Key/value pairs for the YAML block
- `body` `{string}` — Markdown body

**Returns:** `string`

```js
const content = vault.buildNote(
  { title: 'My Note', tags: ['work'], created: '2026-02-19' },
  '## Notes\n\nContent here.'
);
```

---

## `Curator`

Main orchestrator. Wires vault, AI, and config together into a convenient API.

### Constructor

```js
const curator = new Curator({ vault, ai, config });
// ai is optional — pass null for rule-based only
const curator = new Curator({ vault, ai: null, config });
```

**Throws:** If `vault` or `config` is missing.

### `curator.capture(text, [options])`

Capture raw text to the inbox with timestamp frontmatter.

**Parameters:**
- `text` `{string}` — Content to capture
- `options.source` `{string}` — Source tag (default: `'cli'`)

**Returns:** `Promise<string>` — Path of the created note

```js
const path = await curator.capture('Quick idea about async loading');
// → 'inbox/20260219-143022-quick-idea-about-async.md'
```

### `curator.process([options])`

Enrich inbox notes with AI-generated frontmatter. Requires a non-`none` AI provider.

**Parameters:**
- `options.limit` `{number}` — Max notes to process (default: 10)
- `options.dryRun` `{boolean}` — Preview without writing (default: false)
- `options.force` `{boolean}` — Re-process already-enriched notes (default: false)

**Returns:** `Promise<{ processed: number, skipped: number, errors: Array }>`

```js
const result = await curator.process({ limit: 5 });
// { processed: 3, skipped: 2, errors: [] }
```

### `curator.file([options])`

Route processed inbox notes to canonical vault folders. Requires AI.

**Parameters:**
- `options.limit` `{number}` — Max notes to file (default: 10)
- `options.minConfidence` `{number}` — Minimum confidence to auto-file (default: 0.7)
- `options.dryRun` `{boolean}` — Preview without moving (default: false)
- `options.sessionId` `{string}` — Session ID for undo tracking

**Returns:** `Promise<{ filed: number, skipped: number, errors: Array }>`

### `curator.audit([options])`

Check vault structure against configured canonical folders.

**Returns:** `Promise<Object>` — Audit report with counts, issues, and methodology detection

```js
const report = await curator.audit();
// {
//   totalNotes: 142,
//   misplacedNotes: [...],
//   nonCanonicalFolders: ['Dump'],
//   emptyFolders: [],
//   rootViolations: 3,
//   detectedMethodology: 'PARA'
// }
```

### `curator.tidy([options])`

Vault housekeeping — detect and optionally fix duplicates, structure violations, dead notes.

**Parameters:**
- `options.checks` `{string[]}` — `['dupes', 'structure', 'stubs']` or `['all']` (default: `['all']`)
- `options.dryRun` `{boolean}` — Report without fixing (default: false)
- `options.sessionId` `{string}` — Session ID for undo tracking

**Returns:** `Promise<Object>` — Tidy report with issues found and actions taken

### `curator.tasks([options])`

List tasks from the configured tasks folder.

**Parameters:**
- `options.status` `{'open'|'done'}` — Filter by status (default: all)
- `options.project` `{string}` — Filter by project name
- `options.priority` `{'high'|'normal'|'low'}` — Filter by priority

**Returns:** `Promise<Array<Task>>` — Array of task objects

```js
const tasks = await curator.tasks({ status: 'open', project: 'Work' });
// [{ title, due, project, priority, status, path }, ...]
```

### `curator.createTask(text)`

Create a task from natural language text.

**Parameters:**
- `text` `{string}` — Natural language task description

**Returns:** `Promise<{ title, due, project, priority, status, path }>`

```js
const task = await curator.createTask('call dentist next Tuesday urgent');
// { title: 'call dentist', due: '2026-02-24', project: null, priority: 'high', ... }
```

### `curator.completeTask(search)`

Mark a task complete by partial title match or exact path.

**Parameters:**
- `search` `{string}` — Partial title or exact vault path

**Returns:** `Promise<{ ok: boolean, task: Object, message: string }>`

```js
await curator.completeTask('dentist');
```

### `curator.taskBrief()`

Generate a formatted task briefing (overdue, due today/soon, open count).

**Returns:** `Promise<string>` — Markdown-formatted task brief

```js
const brief = await curator.taskBrief();
console.log(brief);
```

---

## `createAIAdapter(config)`

Factory function — returns the right AI adapter for `config.ai.provider`.

**Parameters:**
- `config` `{Object}` — Full config or just the `ai` sub-object

**Returns:** AI adapter instance

```js
const ai = createAIAdapter(config);
// ai.complete(prompt) → Promise<string>
// ai.structured(prompt, schema) → Promise<Object>
```

**Throws:** For unknown providers; for `'openclaw'` outside the OpenClaw skill.

### AI Adapter Interface

All adapters implement:

```js
// Generate a free-form text completion
ai.complete(prompt, options = {}) → Promise<string>

// Generate a structured JSON response matching the schema
ai.structured(prompt, schema, options = {}) → Promise<Object>
```

### Using adapters directly

```js
const { OpenAIAdapter, AnthropicAdapter, OllamaAdapter, NoneAdapter } = require('obsidian-curator');

const ai = new OpenAIAdapter({
  apiKey: 'sk-...',
  model: 'gpt-4o-mini',
  baseUrl: null  // optional custom endpoint
});

const summary = await ai.complete('Summarise this note in one sentence: ...');
```

---

## `Processor`

AI inbox enrichment. Used internally by `curator.process()`.

```js
const { Processor } = require('obsidian-curator');

const processor = new Processor(vault, ai, config);
const result = await processor.processInbox({ limit: 5, dryRun: false, force: false });
// { processed, skipped, errors }
```

---

## `Filer`

AI-powered note routing. Used internally by `curator.file()`.

```js
const { Filer } = require('obsidian-curator');

const filer = new Filer(vault, ai, config);
const result = await filer.fileNotes({ limit: 10, minConfidence: 0.7, dryRun: false });
// { filed, skipped, errors }
```

---

## `StructureAuditor`

Vault structure analysis. Used internally by `curator.audit()`.

```js
const { StructureAuditor } = require('obsidian-curator');

const auditor = new StructureAuditor(vault, config);
const report = await auditor.analyze();
```

---

## `TaskStore`

CRUD operations for vault tasks. Used internally by `curator.tasks()` etc.

```js
const { TaskStore } = require('obsidian-curator');

const store = new TaskStore(vault, config);

// Create a task
const task = await store.createTask({
  title: 'Book dentist appointment',
  due: '2026-02-24',
  project: 'Health',
  priority: 'normal',
  source: 'api'
});

// List tasks
const open = await store.listTasks({ status: 'open' });

// Complete a task
await store.completeTask('dentist');
```

### Task object shape

```js
{
  title: 'Book dentist appointment',
  due: '2026-02-24',       // YYYY-MM-DD or null
  project: 'Health',       // or null
  priority: 'normal',      // 'high' | 'normal' | 'low'
  status: 'open',          // 'open' | 'done'
  source: 'cli',           // how it was created
  path: 'Tasks/book-dentist-appointment.md'
}
```

---

## `parseTask(text, config)`

Natural language → structured task object. Rule-based, no AI.

**Parameters:**
- `text` `{string}` — Natural language task description
- `config` `{Object}` — Loaded curator config (for project keyword matching)

**Returns:** `{ title, due, project, priority }`

```js
const { parseTask } = require('obsidian-curator');

const task = parseTask('urgent: call Alice next Tuesday for work', config);
// {
//   title: 'call Alice',
//   due: '2026-02-24',
//   project: 'Work',
//   priority: 'high'
// }
```

**Date patterns understood:**
- `today`, `tomorrow`
- `next Monday/Tuesday/.../Sunday`
- `this Friday`
- `in 2 days`, `in 3 weeks`, `in a month`
- `before March 1st`, `by end of month`
- `YYYY-MM-DD` literal dates

**Priority patterns:**
- High: `urgent`, `asap`, `immediately`, `critical`, `important`
- Low: `no rush`, `whenever`, `low priority`, `eventually`

---

## `generateTaskBrief(store)`

Generate a Markdown-formatted task briefing. Used internally by `curator.taskBrief()`.

**Parameters:**
- `store` `{TaskStore}` — TaskStore instance

**Returns:** `Promise<string>` — Markdown brief with overdue, due-today, due-soon, and open task counts

```js
const { generateTaskBrief } = require('obsidian-curator');

const store = new TaskStore(vault, config);
const brief = await generateTaskBrief(store);
console.log(brief);
```

---

## Config helpers

```js
const {
  validateConfig,
  getCanonicalFolders,
  getSystemPaths,
  getRootExceptions,
  DEFAULTS,
  PRESET_FOLDERS,
  VALID_PROVIDERS,
  VALID_PRESETS
} = require('obsidian-curator');
```

### `validateConfig(config)`

Validate a config object. Throws with a descriptive message on failure.

### `getCanonicalFolders(config)`

Return the list of canonical top-level folders from a config (preset folders + customFolders + tasks folder).

**Returns:** `string[]`

```js
const folders = getCanonicalFolders(config);
// ['inbox', 'Projects', 'Areas', 'Resources', 'Archives', 'Tasks']
```

### `getSystemPaths(config)`

Return system paths that should never be touched by tidy.

**Returns:** `string[]`

### `getRootExceptions(config)`

Return filenames allowed at vault root without triggering audit warnings.

**Returns:** `string[]`

### Constants

```js
DEFAULTS        // Full default config object
PRESET_FOLDERS  // Folder maps for each preset
VALID_PROVIDERS // ['none', 'openai', 'anthropic', 'ollama', 'openclaw', 'custom']
VALID_PRESETS   // ['para', 'zettelkasten', 'johnny-decimal', 'flat', 'custom']
```

---

## Vault helpers

```js
const { sanitizeUnicode, friendlyCouchError } = require('obsidian-curator');
```

### `sanitizeUnicode(text)`

Strip dangerous control characters (`\x00-\x08`, `\x0e-\x1f`) while preserving normal whitespace and all Unicode/emoji.

**Returns:** `string`

### `friendlyCouchError(err)`

Convert a raw CouchDB/nano error into a human-readable message.

**Returns:** `string`

---

## Error handling

All async methods throw on unexpected errors. CouchDB connectivity errors are surfaced as friendly messages via `friendlyCouchError`. Recommended pattern:

```js
try {
  await vault.ping();
  const result = await curator.process();
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
```
