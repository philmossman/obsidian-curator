'use strict';

/**
 * config command — show, set, or locate configuration.
 *
 * Usage:
 *   obsidian-curator config show         — print current config (password masked)
 *   obsidian-curator config set <k> <v>  — set a dotted key to a value and save
 *   obsidian-curator config path         — print config file location
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const { loadConfig } = require('../../core/config');
const { info, success, error, muted, header, maskSecret, table } = require('../helpers');

/** Default global config path */
const GLOBAL_CONFIG_PATH = path.join(os.homedir(), '.obsidian-curator', 'config.json');

/**
 * Read raw config JSON (no merging/defaults), or return {}.
 * @returns {Object}
 */
function readRawConfig() {
  if (!fs.existsSync(GLOBAL_CONFIG_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf8'));
  } catch (_) {
    return {};
  }
}

/**
 * Write raw config JSON.
 * @param {Object} obj
 */
function writeRawConfig(obj) {
  const dir = path.dirname(GLOBAL_CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

/**
 * Get a nested value from an object by dotted key path.
 * @param {Object} obj
 * @param {string} dotKey - e.g. 'vault.host'
 * @returns {*}
 */
function getNestedValue(obj, dotKey) {
  return dotKey.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}

/**
 * Set a nested value on an object by dotted key path (mutates).
 * Creates intermediate objects as needed.
 * @param {Object} obj
 * @param {string} dotKey
 * @param {*} value
 */
function setNestedValue(obj, dotKey, value) {
  const keys = dotKey.split('.');
  let cursor = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof cursor[keys[i]] !== 'object' || cursor[keys[i]] === null) {
      cursor[keys[i]] = {};
    }
    cursor = cursor[keys[i]];
  }
  cursor[keys[keys.length - 1]] = value;
}

/**
 * Coerce a string value to a sensible type.
 * 'true'/'false' → boolean; numeric strings → number; else string.
 * @param {string} value
 * @returns {string|number|boolean}
 */
function coerceValue(value) {
  if (value === 'true')  return true;
  if (value === 'false') return false;
  const n = Number(value);
  if (!isNaN(n) && value.trim() !== '') return n;
  return value;
}

/**
 * Flatten a nested config object into dotted-key rows for display.
 * Masks passwords and API keys.
 * @param {Object} obj
 * @param {string} prefix
 * @returns {string[][]} Array of [key, value] pairs
 */
function flattenForDisplay(obj, prefix = '') {
  const rows = [];
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      rows.push(...flattenForDisplay(v, fullKey));
    } else {
      const isSensitive = /password|apikey|api_key/i.test(k);
      const display = isSensitive ? maskSecret(String(v)) : (v === null ? '(null)' : String(v));
      rows.push([fullKey, display]);
    }
  }
  return rows;
}

/**
 * @param {Object} args - Parsed arguments
 * @param {string[]} args._ - [subcommand, key?, value?]
 * @returns {Promise<void>}
 */
async function configCommand(args) {
  const sub = args._[0];

  if (!sub || sub === 'show') {
    // ── show ──────────────────────────────────
    let config;
    try {
      config = loadConfig();
    } catch (err) {
      error(`Config error: ${err.message}`);
      muted('Run `obsidian-curator init` to configure.');
      process.exit(1);
    }

    header('Current configuration');
    muted(`  (from ${GLOBAL_CONFIG_PATH})`);
    console.log('');

    const rows = [['Key', 'Value'], ...flattenForDisplay(config)];
    console.log(table(rows));
    return;
  }

  if (sub === 'path') {
    // ── path ──────────────────────────────────
    console.log(GLOBAL_CONFIG_PATH);
    return;
  }

  if (sub === 'set') {
    // ── set <key> <value> ─────────────────────
    const key   = args._[1];
    const value = args._[2];

    if (!key || value === undefined) {
      error('Usage: obsidian-curator config set <key> <value>');
      muted('Example: obsidian-curator config set vault.host myserver.local');
      process.exit(1);
    }

    const raw = readRawConfig();
    setNestedValue(raw, key, coerceValue(value));
    writeRawConfig(raw);

    const isSensitive = /password|apikey|api_key/i.test(key);
    const displayValue = isSensitive ? maskSecret(String(value)) : value;
    success(`Set ${key} = ${displayValue}`);
    muted(`  Saved to ${GLOBAL_CONFIG_PATH}`);
    return;
  }

  error(`Unknown config subcommand: ${sub}`);
  muted('Valid subcommands: show, set, path');
  process.exit(1);
}

module.exports = configCommand;
