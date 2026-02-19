'use strict';

/**
 * Tests for CLI utilities and the capture logic.
 * Uses Node's built-in assert — no external test framework.
 */

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');

const { parseArgs, maskSecret } = require('../../src/cli/helpers');
const Curator = require('../../src/core/curator');

// ─────────────────────────────────────────────
// parseArgs
// ─────────────────────────────────────────────

function testParseArgs() {
  // Positional args
  const a1 = parseArgs(['capture', 'hello world']);
  assert.deepStrictEqual(a1._, ['capture', 'hello world'], 'parseArgs: positionals');

  // Boolean flag
  const a2 = parseArgs(['--dry-run']);
  assert.strictEqual(a2['dry-run'], true, 'parseArgs: boolean flag');

  // --key value
  const a3 = parseArgs(['--limit', '5']);
  assert.strictEqual(a3.limit, '5', 'parseArgs: --key value');

  // --key=value
  const a4 = parseArgs(['--limit=10']);
  assert.strictEqual(a4.limit, '10', 'parseArgs: --key=value');

  // Mixed
  const a5 = parseArgs(['process', '--limit', '3', '--dry-run', '--force']);
  assert.deepStrictEqual(a5._, ['process'], 'parseArgs: mixed positionals');
  assert.strictEqual(a5.limit, '3', 'parseArgs: mixed --limit');
  assert.strictEqual(a5['dry-run'], true, 'parseArgs: mixed --dry-run');
  assert.strictEqual(a5.force, true, 'parseArgs: mixed --force');

  // Short flag
  const a6 = parseArgs(['-h']);
  assert.strictEqual(a6.h, true, 'parseArgs: short flag -h');

  // Empty
  const a7 = parseArgs([]);
  assert.deepStrictEqual(a7._, [], 'parseArgs: empty argv');

  console.log('  ✓ parseArgs');
}

// ─────────────────────────────────────────────
// maskSecret
// ─────────────────────────────────────────────

function testMaskSecret() {
  assert.strictEqual(maskSecret(null),           '(not set)',    'maskSecret: null');
  assert.strictEqual(maskSecret(''),             '(not set)',    'maskSecret: empty string');
  assert.strictEqual(maskSecret('abc'),          '****',         'maskSecret: short string');
  assert.strictEqual(maskSecret('abcdefgh'),     '****efgh',     'maskSecret: normal key');
  assert.strictEqual(maskSecret('sk-proj-xxxx'), '****xxxx',     'maskSecret: sk key');
  console.log('  ✓ maskSecret');
}

// ─────────────────────────────────────────────
// Curator._slugify
// ─────────────────────────────────────────────

function testSlugify() {
  assert.strictEqual(Curator._slugify('Hello World'), 'hello-world', 'slugify: basic');
  assert.strictEqual(Curator._slugify('Remember to call Alice today please'), 'remember-to-call-alice-today-please', 'slugify: 6 words');
  assert.strictEqual(Curator._slugify('One two three four five six seven eight'), 'one-two-three-four-five-six', 'slugify: truncates at 6 words');
  assert.strictEqual(Curator._slugify('Special! chars@#$ here'), 'special-chars-here', 'slugify: strips special chars');
  assert.strictEqual(Curator._slugify('  spaces  '), 'spaces', 'slugify: trims spaces');
  assert.strictEqual(Curator._slugify(''), 'note', 'slugify: empty string returns note');
  assert.strictEqual(Curator._slugify('!!!'), 'note', 'slugify: only special chars returns note');
  console.log('  ✓ Curator._slugify');
}

// ─────────────────────────────────────────────
// Curator._isoStamp
// ─────────────────────────────────────────────

function testIsoStamp() {
  const d = new Date('2024-03-15T14:30:05.000Z');
  // Adjust for local time — create a date with known local time values
  const local = new Date(2024, 2, 15, 14, 30, 5); // month is 0-indexed
  const stamp = Curator._isoStamp(local);
  assert.match(stamp, /^\d{8}-\d{6}$/, 'isoStamp: format YYYYMMDD-HHmmss');
  // Should contain the date parts
  assert.ok(stamp.startsWith('20240315-'), 'isoStamp: date part');
  assert.ok(stamp.endsWith('143005'), 'isoStamp: time part');
  console.log('  ✓ Curator._isoStamp');
}

// ─────────────────────────────────────────────
// Curator.capture() — unit test with a mock vault
// ─────────────────────────────────────────────

async function testCaptureLogic() {
  // Mock VaultClient — records calls without hitting CouchDB
  const written = [];
  const mockVault = {
    buildNote(frontmatter, body) {
      // Use the real buildNote logic shape: just store what we'd pass in
      const fm = Object.entries(frontmatter)
        .map(([k, v]) => {
          if (Array.isArray(v)) return `${k}:\n${v.map(i => `  - ${i}`).join('\n') || '  []'}`;
          return `${k}: ${v}`;
        }).join('\n');
      return `---\n${fm}\n---\n\n${body}`;
    },
    async writeNote(notePath, content) {
      written.push({ notePath, content });
    }
  };

  const config = {
    structure: { folders: { inbox: 'inbox' } }
  };
  const curator = new Curator({ vault: mockVault, ai: null, config });

  const text   = 'Remember to call Alice';
  const result = await curator.capture(text, { source: 'cli' });

  // Path should start with inbox/ and end with .md
  assert.ok(result.startsWith('inbox/'), 'capture: note in inbox folder');
  assert.ok(result.endsWith('.md'), 'capture: note has .md extension');

  // Path should contain the slug
  assert.ok(result.includes('remember-to-call-alice'), 'capture: slug in filename');

  // Exactly one note was written
  assert.strictEqual(written.length, 1, 'capture: exactly one note written');
  const { notePath, content } = written[0];

  // Content should have frontmatter
  assert.ok(content.includes('created:'), 'capture: content has created frontmatter');
  assert.ok(content.includes('source: cli'), 'capture: content has source frontmatter');
  assert.ok(content.includes(text), 'capture: content includes the captured text');

  // Empty text should throw
  await assert.rejects(
    () => curator.capture(''),
    /non-empty/,
    'capture: empty text throws'
  );
  await assert.rejects(
    () => curator.capture('   '),
    /non-empty/,
    'capture: whitespace-only text throws'
  );

  console.log('  ✓ Curator.capture()');
}

// ─────────────────────────────────────────────
// config command helpers — coerceValue (via internal logic test)
// ─────────────────────────────────────────────

function testConfigShow() {
  // Smoke-test that the config command module loads without errors
  const configCmd = require('../../src/cli/commands/config');
  assert.strictEqual(typeof configCmd, 'function', 'config command exports a function');
  console.log('  ✓ config command loads');
}

// ─────────────────────────────────────────────
// Run all
// ─────────────────────────────────────────────

module.exports = async function runCLITests() {
  console.log('\ncli.test.js');
  let passed = 0;
  let failed = 0;

  const syncTests = [
    testParseArgs,
    testMaskSecret,
    testSlugify,
    testIsoStamp,
    testConfigShow,
  ];

  for (const t of syncTests) {
    try {
      t();
      passed++;
    } catch (err) {
      console.error(`  FAILED: ${t.name}: ${err.message}`);
      failed++;
    }
  }

  // Async tests
  try {
    await testCaptureLogic();
    passed++;
  } catch (err) {
    console.error(`  FAILED: testCaptureLogic: ${err.message}`);
    failed++;
  }

  if (failed === 0) console.log('  All CLI tests passed.\n');
  return { passed, failed };
};
