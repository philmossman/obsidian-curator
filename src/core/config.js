'use strict';

/**
 * Config loader and validator for obsidian-curator.
 *
 * Search order (later takes precedence):
 *   1. Built-in defaults
 *   2. ~/.obsidian-curator/config.json  (global)
 *   3. ./.obsidian-curator.json         (local, project-specific)
 *   4. Explicit path passed to loadConfig()
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ─────────────────────────────────────────────
// Default config shape (all keys, all defaults)
// ─────────────────────────────────────────────

const DEFAULTS = {
  vault: {
    host: 'localhost',
    port: 5984,
    database: 'obsidian',
    username: '',
    password: '',
    protocol: 'http'
  },
  structure: {
    preset: 'para',
    folders: {
      inbox: 'inbox'
    },
    customFolders: [],
    rootExceptions: ['Index.md', 'Welcome.md', 'README.md'],
    systemPaths: ['logs/', 'ix:']
  },
  ai: {
    provider: 'none',
    model: null,
    apiKey: null,
    baseUrl: null
  },
  tasks: {
    folder: 'Tasks',
    projects: {},
    defaultPriority: 'normal'
  },
  tidy: {
    autoDeleteConfidence: 0.8,
    testPatterns: ['test-*', 'Test*', 'Untitled*'],
    protectedPaths: [],
    maxAutoActions: 50
  }
};

// ─────────────────────────────────────────────
// Preset folder structures
// ─────────────────────────────────────────────

const PRESET_FOLDERS = {
  para: {
    inbox: 'inbox',
    projects: 'Projects',
    areas: 'Areas',
    resources: 'Resources',
    archive: 'Archives'
  },
  zettelkasten: {
    inbox: 'inbox',
    slipbox: 'Slipbox',
    references: 'References',
    projects: 'Projects',
    archive: 'Archives'
  },
  'johnny-decimal': {
    inbox: 'inbox'
    // User defines the numeric categories themselves
  },
  flat: {
    inbox: 'inbox'
  },
  custom: {}
};

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Deep-merge two plain objects. Arrays are replaced (not concatenated).
 * @param {Object} target
 * @param {Object} source
 * @returns {Object}
 */
function deepMerge(target, source) {
  const output = Object.assign({}, target);
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (sv !== null && typeof sv === 'object' && !Array.isArray(sv)
        && tv !== null && typeof tv === 'object' && !Array.isArray(tv)) {
      output[key] = deepMerge(tv, sv);
    } else {
      output[key] = sv;
    }
  }
  return output;
}

/**
 * Read and parse a JSON file. Returns null if the file doesn't exist.
 * Throws on parse errors (to surface bad configs clearly).
 * @param {string} filePath
 * @returns {Object|null}
 */
function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse config file ${filePath}: ${err.message}`);
  }
}

// ─────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────

const VALID_PROVIDERS = ['none', 'openai', 'anthropic', 'ollama', 'openclaw', 'custom'];
const VALID_PRESETS = ['para', 'zettelkasten', 'johnny-decimal', 'flat', 'custom'];

/**
 * Validate a loaded config object. Throws with a descriptive message on failure.
 * @param {Object} config
 * @throws {Error}
 */
function validateConfig(config) {
  // vault section
  const v = config.vault || {};
  if (typeof v.host !== 'string' || !v.host) {
    throw new Error('config.vault.host must be a non-empty string');
  }
  if (typeof v.port !== 'number' || v.port < 1 || v.port > 65535) {
    throw new Error('config.vault.port must be a number between 1 and 65535');
  }
  if (typeof v.database !== 'string' || !v.database) {
    throw new Error('config.vault.database must be a non-empty string');
  }
  if (!['http', 'https'].includes(v.protocol)) {
    throw new Error('config.vault.protocol must be "http" or "https"');
  }

  // structure section
  const s = config.structure || {};
  if (!VALID_PRESETS.includes(s.preset)) {
    throw new Error(`config.structure.preset must be one of: ${VALID_PRESETS.join(', ')}`);
  }

  // ai section
  const ai = config.ai || {};
  if (!VALID_PROVIDERS.includes(ai.provider)) {
    throw new Error(`config.ai.provider must be one of: ${VALID_PROVIDERS.join(', ')}`);
  }

  // tasks section
  const t = config.tasks || {};
  if (typeof t.folder !== 'string' || !t.folder) {
    throw new Error('config.tasks.folder must be a non-empty string');
  }

  // tidy section
  const tidy = config.tidy || {};
  if (typeof tidy.autoDeleteConfidence !== 'number'
      || tidy.autoDeleteConfidence < 0
      || tidy.autoDeleteConfidence > 1) {
    throw new Error('config.tidy.autoDeleteConfidence must be a number between 0 and 1');
  }
  if (typeof tidy.maxAutoActions !== 'number' || tidy.maxAutoActions < 0) {
    throw new Error('config.tidy.maxAutoActions must be a non-negative number');
  }
}

// ─────────────────────────────────────────────
// Preset merging
// ─────────────────────────────────────────────

/**
 * Apply the preset's canonical folder list to config.structure.
 * User-defined folders in config.structure.folders take precedence.
 * @param {Object} config
 * @returns {Object} Config with preset folders merged in
 */
function applyPreset(config) {
  const preset = config.structure.preset;
  const presetFolders = PRESET_FOLDERS[preset] || {};

  // Preset folders are the base; user config overrides
  config.structure.folders = Object.assign({}, presetFolders, config.structure.folders);
  return config;
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Load, merge and validate configuration.
 *
 * Search order (later wins):
 *   defaults → ~/.obsidian-curator/config.json → ./.obsidian-curator.json → explicitPath
 *
 * @param {string} [explicitPath] - Optional absolute path to a config file
 * @param {Object} [options]
 * @param {boolean} [options.validate=true] - Run schema validation
 * @returns {Object} Resolved config
 */
function loadConfig(explicitPath = null, options = {}) {
  const { validate = true } = options;

  // Start with deep-cloned defaults
  let config = JSON.parse(JSON.stringify(DEFAULTS));

  // 1. Global config: ~/.obsidian-curator/config.json
  const globalPath = path.join(os.homedir(), '.obsidian-curator', 'config.json');
  const globalConfig = readJson(globalPath);
  if (globalConfig) {
    config = deepMerge(config, globalConfig);
  }

  // 2. Local config: ./.obsidian-curator.json
  const localPath = path.join(process.cwd(), '.obsidian-curator.json');
  const localConfig = readJson(localPath);
  if (localConfig) {
    config = deepMerge(config, localConfig);
  }

  // 3. Explicit path (highest priority)
  if (explicitPath) {
    const explicitConfig = readJson(explicitPath);
    if (explicitConfig) {
      config = deepMerge(config, explicitConfig);
    } else {
      throw new Error(`Config file not found: ${explicitPath}`);
    }
  }

  // Apply preset folder defaults
  config = applyPreset(config);

  // Validate
  if (validate) {
    validateConfig(config);
  }

  return config;
}

/**
 * Return the canonical list of allowed top-level folders from a config.
 * Used by tidy scanner and auditor.
 * @param {Object} config
 * @returns {string[]}
 */
function getCanonicalFolders(config) {
  const folders = config.structure.folders || {};
  const canonical = Object.values(folders).filter(Boolean);
  const custom = config.structure.customFolders || [];
  // tasks folder is also canonical
  const taskFolder = config.tasks && config.tasks.folder;
  if (taskFolder) canonical.push(taskFolder);
  return [...new Set([...canonical, ...custom])];
}

/**
 * Return system paths that should never be touched.
 * @param {Object} config
 * @returns {string[]}
 */
function getSystemPaths(config) {
  return (config.structure && config.structure.systemPaths) || [];
}

/**
 * Return root-level filenames that are allowed at vault root.
 * @param {Object} config
 * @returns {string[]}
 */
function getRootExceptions(config) {
  return (config.structure && config.structure.rootExceptions) || [];
}

module.exports = loadConfig;
module.exports.loadConfig = loadConfig;
module.exports.validateConfig = validateConfig;
module.exports.applyPreset = applyPreset;
module.exports.deepMerge = deepMerge;
module.exports.getCanonicalFolders = getCanonicalFolders;
module.exports.getSystemPaths = getSystemPaths;
module.exports.getRootExceptions = getRootExceptions;
module.exports.DEFAULTS = DEFAULTS;
module.exports.PRESET_FOLDERS = PRESET_FOLDERS;
module.exports.VALID_PROVIDERS = VALID_PROVIDERS;
module.exports.VALID_PRESETS = VALID_PRESETS;
