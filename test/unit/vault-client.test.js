'use strict';

/**
 * Tests for src/core/vault-client.js
 * Tests only non-CouchDB methods (parseFrontmatter, buildNote, helpers).
 * No CouchDB connection required.
 */

const assert = require('assert');
const VaultClient = require('../../src/core/vault-client');
const { sanitizeUnicode, friendlyCouchError } = require('../../src/core/vault-client');

// We don't connect to CouchDB — pass dummy config that satisfies the constructor
// but will fail if any DB method is actually called.
const DUMMY_CONFIG = {
  host: '127.0.0.1',
  port: 5984,
  database: 'test',
  username: '',
  password: '',
  protocol: 'http'
};

// ─────────────────────────────────────────────
// parseFrontmatter
// ─────────────────────────────────────────────

function testParseFrontmatterNoFrontmatter() {
  const vc = new VaultClient(DUMMY_CONFIG);

  const { frontmatter, body } = vc.parseFrontmatter('Hello world\nSecond line');
  assert.deepStrictEqual(frontmatter, {}, 'no frontmatter: empty object');
  assert.strictEqual(body, 'Hello world\nSecond line', 'no frontmatter: body preserved');

  console.log('  ✓ parseFrontmatter: no frontmatter');
}

function testParseFrontmatterBasic() {
  const vc = new VaultClient(DUMMY_CONFIG);

  const content = '---\ntitle: My Note\ntags: [ai, tools]\n---\nBody here.';
  const { frontmatter, body } = vc.parseFrontmatter(content);

  assert.strictEqual(frontmatter.title, 'My Note', 'parseFrontmatter: string field');
  assert.deepStrictEqual(frontmatter.tags, ['ai', 'tools'], 'parseFrontmatter: inline array');
  assert.strictEqual(body, 'Body here.', 'parseFrontmatter: body after delimiter');

  console.log('  ✓ parseFrontmatter: basic fields');
}

function testParseFrontmatterTypes() {
  const vc = new VaultClient(DUMMY_CONFIG);

  const content = [
    '---',
    'boolTrue: true',
    'boolFalse: false',
    'num: 42',
    'float: 3.14',
    'nullVal: null',
    'empty: ',
    '---',
    ''
  ].join('\n');

  const { frontmatter } = vc.parseFrontmatter(content);

  assert.strictEqual(frontmatter.boolTrue, true, 'parseFrontmatter: boolean true');
  assert.strictEqual(frontmatter.boolFalse, false, 'parseFrontmatter: boolean false');
  assert.strictEqual(frontmatter.num, 42, 'parseFrontmatter: integer');
  assert.strictEqual(frontmatter.float, 3.14, 'parseFrontmatter: float');
  assert.strictEqual(frontmatter.nullVal, null, 'parseFrontmatter: null');
  assert.strictEqual(frontmatter.empty, '', 'parseFrontmatter: empty string');

  console.log('  ✓ parseFrontmatter: type coercion');
}

function testParseFrontmatterUnclosed() {
  const vc = new VaultClient(DUMMY_CONFIG);

  const content = '---\ntitle: Broken\nno closing delimiter';
  const { frontmatter, body } = vc.parseFrontmatter(content);

  assert.deepStrictEqual(frontmatter, {}, 'unclosed frontmatter: returns empty object');
  assert.strictEqual(body, content, 'unclosed frontmatter: full content as body');

  console.log('  ✓ parseFrontmatter: unclosed delimiter treated as no frontmatter');
}

function testParseFrontmatterEmptyBody() {
  const vc = new VaultClient(DUMMY_CONFIG);

  const content = '---\ntitle: Only frontmatter\n---\n';
  const { frontmatter, body } = vc.parseFrontmatter(content);

  assert.strictEqual(frontmatter.title, 'Only frontmatter', 'parseFrontmatter: title');
  assert.strictEqual(body, '', 'parseFrontmatter: empty body');

  console.log('  ✓ parseFrontmatter: empty body');
}

function testParseFrontmatterQuotedStrings() {
  const vc = new VaultClient(DUMMY_CONFIG);

  const content = '---\ntitle: "Quoted Title"\nauthor: \'Phil\'\n---\nBody';
  const { frontmatter } = vc.parseFrontmatter(content);

  assert.strictEqual(frontmatter.title, 'Quoted Title', 'parseFrontmatter: double-quoted string unquoted');
  assert.strictEqual(frontmatter.author, 'Phil', 'parseFrontmatter: single-quoted string unquoted');

  console.log('  ✓ parseFrontmatter: quoted strings');
}

// ─────────────────────────────────────────────
// buildNote
// ─────────────────────────────────────────────

function testBuildNoteNoFrontmatter() {
  const vc = new VaultClient(DUMMY_CONFIG);

  const result = vc.buildNote({}, 'Just the body');
  assert.strictEqual(result, 'Just the body', 'buildNote: empty frontmatter returns body only');

  const result2 = vc.buildNote(null, 'Body text');
  assert.strictEqual(result2, 'Body text', 'buildNote: null frontmatter returns body only');

  console.log('  ✓ buildNote: no frontmatter');
}

function testBuildNoteBasic() {
  const vc = new VaultClient(DUMMY_CONFIG);

  const note = vc.buildNote({ title: 'My Note', created: '2026-01-01' }, 'Body text');
  assert.ok(note.startsWith('---\n'), 'buildNote: starts with ---');
  assert.ok(note.includes('title: My Note'), 'buildNote: title field');
  assert.ok(note.includes('created: 2026-01-01'), 'buildNote: date field');
  assert.ok(note.endsWith('\nBody text'), 'buildNote: body appended');

  console.log('  ✓ buildNote: basic frontmatter');
}

function testBuildNoteArrayField() {
  const vc = new VaultClient(DUMMY_CONFIG);

  const note = vc.buildNote({ tags: ['ai', 'tools', 'obsidian'] }, 'Body');
  assert.ok(note.includes('tags:'), 'buildNote: array field key');
  assert.ok(note.includes('  - ai'), 'buildNote: array item 1');
  assert.ok(note.includes('  - tools'), 'buildNote: array item 2');
  assert.ok(note.includes('  - obsidian'), 'buildNote: array item 3');

  console.log('  ✓ buildNote: array field');
}

function testBuildNoteRoundtrip() {
  const vc = new VaultClient(DUMMY_CONFIG);

  const original = {
    title: 'Round-trip test',
    tags: ['a', 'b'],
    processed: true,
    score: 42
  };
  const body = 'Some content here.';

  const note = vc.buildNote(original, body);
  const { frontmatter, body: parsedBody } = vc.parseFrontmatter(note);

  assert.strictEqual(frontmatter.title, original.title, 'roundtrip: title');
  assert.deepStrictEqual(frontmatter.tags, original.tags, 'roundtrip: tags array');
  assert.strictEqual(frontmatter.processed, original.processed, 'roundtrip: boolean');
  assert.strictEqual(frontmatter.score, original.score, 'roundtrip: number');
  assert.strictEqual(parsedBody.trim(), body, 'roundtrip: body');

  console.log('  ✓ buildNote + parseFrontmatter round-trip');
}

// ─────────────────────────────────────────────
// sanitizeUnicode
// ─────────────────────────────────────────────

function testSanitizeUnicode() {
  // Normal strings pass through unchanged
  assert.strictEqual(sanitizeUnicode('Hello world'), 'Hello world', 'sanitize: normal string');
  assert.strictEqual(sanitizeUnicode('tab\there'), 'tab\there', 'sanitize: tab preserved');
  assert.strictEqual(sanitizeUnicode('line\nbreak'), 'line\nbreak', 'sanitize: newline preserved');

  // Emoji and unicode preserved
  assert.strictEqual(sanitizeUnicode('Hello 🌍'), 'Hello 🌍', 'sanitize: emoji preserved');
  assert.strictEqual(sanitizeUnicode('Ünïcödé'), 'Ünïcödé', 'sanitize: unicode preserved');

  // Dangerous control chars stripped
  const withNull = 'before\x00after';
  assert.strictEqual(sanitizeUnicode(withNull), 'beforeafter', 'sanitize: null byte stripped');

  const withCtrl = 'pre\x07post';
  assert.strictEqual(sanitizeUnicode(withCtrl), 'prepost', 'sanitize: BEL control char stripped');

  // Non-string coerced
  assert.strictEqual(sanitizeUnicode(42), '42', 'sanitize: number coerced to string');
  assert.strictEqual(sanitizeUnicode(null), '', 'sanitize: null → empty string');
  assert.strictEqual(sanitizeUnicode(undefined), '', 'sanitize: undefined → empty string');

  console.log('  ✓ sanitizeUnicode');
}

// ─────────────────────────────────────────────
// friendlyCouchError
// ─────────────────────────────────────────────

function testFriendlyCouchError() {
  // null/undefined
  assert.ok(friendlyCouchError(null).includes('Unknown'), 'friendlyCouchError: null');

  // ECONNREFUSED
  const connRefused = new Error('connect ECONNREFUSED 127.0.0.1:5984');
  connRefused.code = 'ECONNREFUSED';
  assert.ok(friendlyCouchError(connRefused).toLowerCase().includes('not reachable') ||
            friendlyCouchError(connRefused).toLowerCase().includes('econnrefused'),
            'friendlyCouchError: ECONNREFUSED');

  // 401
  const authErr = new Error('Unauthorized');
  authErr.statusCode = 401;
  assert.ok(friendlyCouchError(authErr).toLowerCase().includes('auth'),
            'friendlyCouchError: 401 → auth message');

  // 404
  const notFound = new Error('not found');
  notFound.statusCode = 404;
  assert.ok(friendlyCouchError(notFound).toLowerCase().includes('not found'),
            'friendlyCouchError: 404 → not found message');

  // Generic
  const generic = new Error('Something broke');
  assert.ok(friendlyCouchError(generic).includes('Something broke'),
            'friendlyCouchError: generic error includes message');

  console.log('  ✓ friendlyCouchError');
}

// ─────────────────────────────────────────────
// _pathToId (private, tested via known behavior)
// ─────────────────────────────────────────────

function testPathToId() {
  const vc = new VaultClient(DUMMY_CONFIG);

  // Paths are lowercased
  assert.strictEqual(vc._pathToId('inbox/My-Note.md'), 'inbox/my-note.md', '_pathToId: lowercased');

  // Paths starting with _ get a / prefix (LiveSync convention)
  assert.strictEqual(vc._pathToId('_config.md'), '/_config.md', '_pathToId: _ prefix gets /');

  // Normal path unchanged except lowercasing
  assert.strictEqual(vc._pathToId('Projects/work.md'), 'projects/work.md', '_pathToId: normal path');

  console.log('  ✓ _pathToId');
}

// ─────────────────────────────────────────────
// _createChunks
// ─────────────────────────────────────────────

function testCreateChunks() {
  const vc = new VaultClient(DUMMY_CONFIG);

  // Empty string → one empty chunk
  const empty = vc._createChunks('');
  assert.deepStrictEqual(empty, [''], '_createChunks: empty string → one empty chunk');

  // Short content → one chunk
  const short = vc._createChunks('hello world');
  assert.strictEqual(short.length, 1, '_createChunks: short content → 1 chunk');
  assert.strictEqual(short[0], 'hello world', '_createChunks: content preserved');

  // Content exactly at chunk boundary
  const boundary = 'x'.repeat(50000);
  const boundaryChunks = vc._createChunks(boundary);
  assert.strictEqual(boundaryChunks.length, 1, '_createChunks: exactly 50000 chars → 1 chunk');

  // Content that splits across two chunks
  const big = 'a'.repeat(50001);
  const bigChunks = vc._createChunks(big);
  assert.strictEqual(bigChunks.length, 2, '_createChunks: 50001 chars → 2 chunks');
  assert.strictEqual(bigChunks[0].length, 50000, '_createChunks: first chunk is 50000');
  assert.strictEqual(bigChunks[1].length, 1, '_createChunks: second chunk is 1');

  console.log('  ✓ _createChunks');
}

// ─────────────────────────────────────────────
// Run all
// ─────────────────────────────────────────────

module.exports = function runVaultClientTests() {
  console.log('\nvault-client.test.js');
  let passed = 0;
  let failed = 0;

  const run = (fn) => {
    try {
      fn();
      passed++;
    } catch (err) {
      console.error(`  FAILED: ${fn.name}:`, err.message);
      failed++;
    }
  };

  run(testParseFrontmatterNoFrontmatter);
  run(testParseFrontmatterBasic);
  run(testParseFrontmatterTypes);
  run(testParseFrontmatterUnclosed);
  run(testParseFrontmatterEmptyBody);
  run(testParseFrontmatterQuotedStrings);
  run(testBuildNoteNoFrontmatter);
  run(testBuildNoteBasic);
  run(testBuildNoteArrayField);
  run(testBuildNoteRoundtrip);
  run(testSanitizeUnicode);
  run(testFriendlyCouchError);
  run(testPathToId);
  run(testCreateChunks);

  if (failed === 0) {
    console.log('  All vault-client tests passed.\n');
  }
  return { passed, failed };
};
