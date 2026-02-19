'use strict';

/**
 * Tests for src/core/config.js
 * Uses Node's built-in assert — no external test framework.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const {
  loadConfig,
  validateConfig,
  applyPreset,
  deepMerge,
  getCanonicalFolders,
  getSystemPaths,
  getRootExceptions,
  DEFAULTS,
  PRESET_FOLDERS,
  VALID_PROVIDERS,
  VALID_PRESETS
} = require('../../src/core/config');

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

let tmpFiles = [];

function writeTempConfig(obj) {
  const tmpPath = path.join(os.tmpdir(), `oc-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(tmpPath, JSON.stringify(obj));
  tmpFiles.push(tmpPath);
  return tmpPath;
}

function cleanup() {
  for (const f of tmpFiles) {
    try { fs.unlinkSync(f); } catch (_) {}
  }
  tmpFiles = [];
}

// ─────────────────────────────────────────────
// deepMerge
// ─────────────────────────────────────────────

function testDeepMerge() {
  // Nested objects are merged
  const merged = deepMerge({ a: { x: 1, y: 2 }, b: 3 }, { a: { y: 99, z: 100 }, c: 4 });
  assert.strictEqual(merged.a.x, 1, 'deepMerge: untouched nested key preserved');
  assert.strictEqual(merged.a.y, 99, 'deepMerge: nested key overridden');
  assert.strictEqual(merged.a.z, 100, 'deepMerge: new nested key added');
  assert.strictEqual(merged.b, 3, 'deepMerge: top-level untouched');
  assert.strictEqual(merged.c, 4, 'deepMerge: top-level added');

  // Arrays are replaced, not concatenated
  const m2 = deepMerge({ arr: [1, 2, 3] }, { arr: [4, 5] });
  assert.deepStrictEqual(m2.arr, [4, 5], 'deepMerge: arrays replaced not concatenated');

  // Source null does not clobber target object
  const m3 = deepMerge({ obj: { x: 1 } }, { obj: null });
  assert.strictEqual(m3.obj, null, 'deepMerge: null in source replaces target');

  console.log('  ✓ deepMerge');
}

// ─────────────────────────────────────────────
// validateConfig
// ─────────────────────────────────────────────

function testValidateConfig() {
  // Valid minimal config should not throw
  const valid = JSON.parse(JSON.stringify(DEFAULTS));
  assert.doesNotThrow(() => validateConfig(valid), 'validateConfig: defaults should be valid');

  // Missing host
  const noHost = JSON.parse(JSON.stringify(DEFAULTS));
  noHost.vault.host = '';
  assert.throws(() => validateConfig(noHost), /host/, 'validateConfig: empty host throws');

  // Bad port
  const badPort = JSON.parse(JSON.stringify(DEFAULTS));
  badPort.vault.port = 99999;
  assert.throws(() => validateConfig(badPort), /port/, 'validateConfig: bad port throws');

  // Bad protocol
  const badProto = JSON.parse(JSON.stringify(DEFAULTS));
  badProto.vault.protocol = 'ftp';
  assert.throws(() => validateConfig(badProto), /protocol/, 'validateConfig: bad protocol throws');

  // Bad ai.provider
  const badProvider = JSON.parse(JSON.stringify(DEFAULTS));
  badProvider.ai.provider = 'gpt-magic';
  assert.throws(() => validateConfig(badProvider), /provider/, 'validateConfig: unknown provider throws');

  // Bad tidy threshold
  const badThreshold = JSON.parse(JSON.stringify(DEFAULTS));
  badThreshold.tidy.autoDeleteConfidence = 1.5;
  assert.throws(() => validateConfig(badThreshold), /autoDeleteConfidence/, 'validateConfig: bad confidence throws');

  console.log('  ✓ validateConfig');
}

// ─────────────────────────────────────────────
// applyPreset
// ─────────────────────────────────────────────

function testApplyPreset() {
  // PARA preset populates all canonical folders
  const config = JSON.parse(JSON.stringify(DEFAULTS));
  config.structure.preset = 'para';
  config.structure.folders = {}; // start empty
  const result = applyPreset(config);
  assert.strictEqual(result.structure.folders.inbox, 'inbox', 'applyPreset para: inbox');
  assert.strictEqual(result.structure.folders.projects, 'Projects', 'applyPreset para: projects');
  assert.strictEqual(result.structure.folders.areas, 'Areas', 'applyPreset para: areas');

  // Zettelkasten preset
  const config2 = JSON.parse(JSON.stringify(DEFAULTS));
  config2.structure.preset = 'zettelkasten';
  config2.structure.folders = {};
  const result2 = applyPreset(config2);
  assert.strictEqual(result2.structure.folders.slipbox, 'Slipbox', 'applyPreset zettelkasten: slipbox');

  // User override takes precedence
  const config3 = JSON.parse(JSON.stringify(DEFAULTS));
  config3.structure.preset = 'para';
  config3.structure.folders = { projects: 'MyProjects' };
  const result3 = applyPreset(config3);
  assert.strictEqual(result3.structure.folders.projects, 'MyProjects', 'applyPreset: user override wins');
  assert.strictEqual(result3.structure.folders.areas, 'Areas', 'applyPreset: non-overridden keys still from preset');

  console.log('  ✓ applyPreset');
}

// ─────────────────────────────────────────────
// loadConfig with explicit path
// ─────────────────────────────────────────────

function testLoadConfigFromFile() {
  // Write a minimal config override
  const tmpPath = writeTempConfig({
    vault: {
      host: 'myserver',
      port: 5984,
      database: 'myvault',
      protocol: 'http',
      username: '',
      password: ''
    }
  });

  const config = loadConfig(tmpPath);
  assert.strictEqual(config.vault.host, 'myserver', 'loadConfig: host from file');
  assert.strictEqual(config.vault.database, 'myvault', 'loadConfig: database from file');
  // Non-overridden defaults preserved
  assert.strictEqual(config.ai.provider, 'none', 'loadConfig: ai.provider defaults to none');
  assert.strictEqual(typeof config.tidy.autoDeleteConfidence, 'number', 'loadConfig: tidy defaults present');

  console.log('  ✓ loadConfig from explicit file');
}

function testLoadConfigMissingFile() {
  assert.throws(
    () => loadConfig('/no/such/file/config.json'),
    /not found/,
    'loadConfig: throws on missing explicit file'
  );
  console.log('  ✓ loadConfig throws on missing explicit file');
}

function testLoadConfigInvalidJson() {
  const tmpPath = path.join(os.tmpdir(), `oc-bad-${Date.now()}.json`);
  fs.writeFileSync(tmpPath, '{ invalid json }');
  tmpFiles.push(tmpPath);
  assert.throws(
    () => loadConfig(tmpPath),
    /Failed to parse/,
    'loadConfig: throws on invalid JSON'
  );
  console.log('  ✓ loadConfig throws on invalid JSON');
}

// ─────────────────────────────────────────────
// getCanonicalFolders
// ─────────────────────────────────────────────

function testGetCanonicalFolders() {
  const config = loadConfig(writeTempConfig({
    vault: { host: 'h', port: 5984, database: 'db', protocol: 'http', username: '', password: '' },
    structure: {
      preset: 'para',
      folders: { inbox: 'inbox', projects: 'Projects', areas: 'Areas', resources: 'Resources', archive: 'Archives' },
      customFolders: ['Photography']
    },
    tasks: { folder: 'Tasks', projects: {}, defaultPriority: 'normal' }
  }));

  const folders = getCanonicalFolders(config);
  assert.ok(folders.includes('inbox'), 'getCanonicalFolders: inbox included');
  assert.ok(folders.includes('Projects'), 'getCanonicalFolders: Projects included');
  assert.ok(folders.includes('Photography'), 'getCanonicalFolders: custom folder included');
  assert.ok(folders.includes('Tasks'), 'getCanonicalFolders: tasks folder included');
  console.log('  ✓ getCanonicalFolders');
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

function testConstants() {
  assert.ok(Array.isArray(VALID_PROVIDERS), 'VALID_PROVIDERS is array');
  assert.ok(VALID_PROVIDERS.includes('none'), 'VALID_PROVIDERS includes none');
  assert.ok(VALID_PROVIDERS.includes('openai'), 'VALID_PROVIDERS includes openai');
  assert.ok(VALID_PROVIDERS.includes('anthropic'), 'VALID_PROVIDERS includes anthropic');
  assert.ok(VALID_PROVIDERS.includes('ollama'), 'VALID_PROVIDERS includes ollama');

  assert.ok(Array.isArray(VALID_PRESETS), 'VALID_PRESETS is array');
  assert.ok(VALID_PRESETS.includes('para'), 'VALID_PRESETS includes para');
  assert.ok(VALID_PRESETS.includes('zettelkasten'), 'VALID_PRESETS includes zettelkasten');

  assert.ok(PRESET_FOLDERS.para, 'PRESET_FOLDERS has para');
  assert.ok(PRESET_FOLDERS.zettelkasten, 'PRESET_FOLDERS has zettelkasten');
  assert.ok(PRESET_FOLDERS.flat, 'PRESET_FOLDERS has flat');

  console.log('  ✓ constants');
}

// ─────────────────────────────────────────────
// Run all
// ─────────────────────────────────────────────

module.exports = function runConfigTests() {
  console.log('\nconfig.test.js');
  try {
    testDeepMerge();
    testValidateConfig();
    testApplyPreset();
    testLoadConfigFromFile();
    testLoadConfigMissingFile();
    testLoadConfigInvalidJson();
    testGetCanonicalFolders();
    testConstants();
    console.log('  All config tests passed.\n');
    return { passed: 8, failed: 0 };
  } catch (err) {
    console.error('  FAILED:', err.message);
    return { passed: 0, failed: 1, error: err };
  } finally {
    cleanup();
  }
};
