'use strict';

/**
 * Tests for the Processor feature module.
 * Uses a mock AI adapter and a mock VaultClient — no real vault or API calls.
 */

const assert    = require('assert');
const Processor = require('../../src/features/processor');
const AIAdapter = require('../../src/ai/adapter');

// ─────────────────────────────────────────────
// Mock helpers
// ─────────────────────────────────────────────

/** Minimal mock vault that tracks writes. */
function makeMockVault(notes = []) {
  const written = [];
  return {
    _written: written,
    async listNotes() { return notes; },
    async readNote(p)  {
      const n = notes.find(x => x.path === p);
      return n ? { path: n.path, content: n.content } : null;
    },
    async writeNote(path, content) { written.push({ path, content }); },
    parseFrontmatter(content) {
      // Simple parser: extract YAML block
      const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!match) return { frontmatter: {}, body: content };
      const frontmatter = {};
      for (const line of match[1].split('\n')) {
        const m = line.match(/^(\w+):\s*(.*)$/);
        if (m) frontmatter[m[1]] = m[2].trim();
      }
      return { frontmatter, body: match[2] };
    },
    buildNote(frontmatter, body) {
      const fm = Object.entries(frontmatter).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n');
      return `---\n${fm}\n---\n${body}`;
    }
  };
}

/** Mock AI adapter that returns a fixed analysis. */
class MockAIAdapter extends AIAdapter {
  constructor(response = null) {
    super({});
    this._response = response || {
      folder:     'Projects',
      tags:       ['test', 'note'],
      related:    [],
      summary:    'Test note summary',
      confidence: 'high'
    };
    this.calls = [];
  }
  async complete(prompt, opts) {
    this.calls.push({ type: 'complete', prompt });
    return JSON.stringify(this._response);
  }
  async structured(prompt, schema, opts) {
    this.calls.push({ type: 'structured', prompt });
    return this._response;
  }
}

/** NoneAdapter stub. */
class NoneAdapter extends AIAdapter {
  constructor() { super({}); }
  async complete()    { return null; }
  async structured()  { return null; }
}
// Fake constructor name
Object.defineProperty(NoneAdapter, 'name', { value: 'NoneAdapter' });

// ─────────────────────────────────────────────
// Config fixture
// ─────────────────────────────────────────────

const BASE_CONFIG = {
  structure: {
    preset: 'para',
    folders: {
      inbox:     'inbox',
      projects:  'Projects',
      areas:     'Areas',
      resources: 'Resources',
      archive:   'Archives'
    },
    customFolders: [],
    rootExceptions: ['Index.md'],
    systemPaths: []
  },
  tasks: { folder: 'Tasks', projects: {} },
  tidy:  { autoDeleteConfidence: 0.8, testPatterns: ['Untitled*'], maxAutoActions: 50 }
};

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

async function testConstructorValidation() {
  assert.throws(() => new Processor(null, null, BASE_CONFIG), /vault/, 'throws without vault');
  assert.throws(() => new Processor({}, null, null),          /config/, 'throws without config');
  const p = new Processor({}, null, BASE_CONFIG);
  assert.ok(p, 'constructs without AI');
  console.log('  ✓ Processor constructor validation');
}

async function testNoAiReturnsMessage() {
  const vault = makeMockVault([]);
  const p     = new Processor(vault, new NoneAdapter(), BASE_CONFIG);
  const res   = await p.processInbox({});
  assert.ok(res.message, 'returns message when no AI');
  assert.strictEqual(res.processed, 0, 'no notes processed without AI');
  console.log('  ✓ Processor.processInbox — no-op without AI');
}

async function testSkipsAlreadyProcessed() {
  const notes = [{
    path:    'inbox/note-abc.md',
    content: '---\nprocessed: true\n---\nsome content',
    size:    50
  }];
  const vault = makeMockVault(notes);
  const ai    = new MockAIAdapter();
  const p     = new Processor(vault, ai, BASE_CONFIG);
  const res   = await p.processInbox({ limit: 10 });
  assert.strictEqual(res.skipped,   1, 'skips already-processed note');
  assert.strictEqual(res.processed, 0, 'zero notes processed');
  assert.strictEqual(ai.calls.length, 0, 'AI not called for already-processed note');
  console.log('  ✓ Processor skips already-processed notes');
}

async function testForceReprocesses() {
  const notes = [{
    path:    'inbox/note-abc.md',
    content: '---\nprocessed: true\n---\nsome content',
    size:    50
  }];
  const vault = makeMockVault(notes);
  const ai    = new MockAIAdapter();
  const p     = new Processor(vault, ai, BASE_CONFIG);
  const res   = await p.processInbox({ limit: 10, force: true });
  assert.strictEqual(res.processed, 1, 'force re-processes');
  assert.ok(ai.calls.length > 0, 'AI was called with force=true');
  console.log('  ✓ Processor.processInbox with force=true');
}

async function testDryRunDoesNotWrite() {
  const notes = [{
    path:    'inbox/fresh-note.md',
    content: '---\ncreated: 2026-01-01\n---\nFresh content here',
    size:    40
  }];
  const vault = makeMockVault(notes);
  const ai    = new MockAIAdapter();
  const p     = new Processor(vault, ai, BASE_CONFIG);
  const res   = await p.processInbox({ dryRun: true });
  assert.strictEqual(res.processed, 1,   'reports 1 processed');
  assert.strictEqual(vault._written.length, 0, 'dry-run: nothing written');
  console.log('  ✓ Processor dry-run does not write');
}

async function testNormalProcessingWritesBack() {
  const notes = [{
    path:    'inbox/fresh-note.md',
    content: '---\ncreated: 2026-01-01\n---\nFresh content here',
    size:    40
  }];
  const vault = makeMockVault(notes);
  const ai    = new MockAIAdapter({
    folder:     'Projects',
    tags:       ['project', 'test'],
    related:    [],
    summary:    'A test note',
    confidence: 'high'
  });
  const p   = new Processor(vault, ai, BASE_CONFIG);
  const res = await p.processInbox({});
  assert.strictEqual(res.processed, 1, 'processed 1 note');
  assert.strictEqual(vault._written.length, 1, 'wrote back to vault');
  const written = vault._written[0];
  assert.strictEqual(written.path, 'inbox/fresh-note.md', 'wrote to same path');
  assert.ok(written.content.includes('ai_suggestions'), 'written content has ai_suggestions');
  console.log('  ✓ Processor writes enriched frontmatter back');
}

async function testOnlyProcessesInboxNotes() {
  const notes = [
    { path: 'inbox/note.md',    content: '---\ncreated: now\n---\nInbox note', size: 30 },
    { path: 'Projects/other.md', content: '---\ncreated: now\n---\nProject note', size: 40 }
  ];
  const vault = makeMockVault(notes);
  const ai    = new MockAIAdapter();
  const p     = new Processor(vault, ai, BASE_CONFIG);
  const res   = await p.processInbox({ limit: 10 });
  assert.strictEqual(res.processed, 1, 'only processed inbox note');
  console.log('  ✓ Processor only processes inbox notes');
}

async function testLimitIsRespected() {
  const notes = Array.from({ length: 5 }, (_, i) => ({
    path:    `inbox/note-${i}.md`,
    content: `---\ncreated: now\n---\nNote ${i}`,
    size:    30
  }));
  const vault = makeMockVault(notes);
  const ai    = new MockAIAdapter();
  const p     = new Processor(vault, ai, BASE_CONFIG);
  const res   = await p.processInbox({ limit: 2 });
  assert.strictEqual(res.processed, 2, 'respects limit');
  console.log('  ✓ Processor respects limit option');
}

// ─────────────────────────────────────────────
// Run all
// ─────────────────────────────────────────────

module.exports = async function runProcessorTests() {
  console.log('\nprocessor.test.js');
  let passed = 0;
  let failed = 0;

  const tests = [
    testConstructorValidation,
    testNoAiReturnsMessage,
    testSkipsAlreadyProcessed,
    testForceReprocesses,
    testDryRunDoesNotWrite,
    testNormalProcessingWritesBack,
    testOnlyProcessesInboxNotes,
    testLimitIsRespected
  ];

  for (const t of tests) {
    try {
      await t();
      passed++;
    } catch (err) {
      console.error(`  FAILED: ${t.name}: ${err.message}`);
      failed++;
    }
  }

  if (failed === 0) console.log('  All Processor tests passed.\n');
  return { passed, failed };
};
