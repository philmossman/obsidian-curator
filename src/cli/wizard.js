'use strict';

/**
 * Interactive setup wizard for `obsidian-curator init`.
 *
 * Walks users through:
 *   1. CouchDB connection
 *   2. Folder structure preset
 *   3. AI provider
 *   4. Task projects (optional)
 *   5. Write config to ~/.obsidian-curator/config.json
 *
 * No external dependencies — uses readline and ANSI codes directly.
 */

const readline = require('readline');
const fs       = require('fs');
const path     = require('path');
const os       = require('os');

const VaultClient     = require('../core/vault-client');
const { DEFAULTS, PRESET_FOLDERS, VALID_PRESETS, VALID_PROVIDERS } = require('../core/config');
const { success, error, warn, info, header, muted, coloured, ANSI } = require('./helpers');

// ─────────────────────────────────────────────
// readline helpers
// ─────────────────────────────────────────────

/**
 * Create a readline interface attached to stdin/stdout.
 * @returns {readline.Interface}
 */
function createRL() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
  });
}

/**
 * Ask a single question and return the answer as a Promise.
 * @param {readline.Interface} rl
 * @param {string} question - Prompt text
 * @param {string} [defaultValue] - Value used when user presses Enter
 * @returns {Promise<string>}
 */
function ask(rl, question, defaultValue = '') {
  const defaultHint = defaultValue !== '' ? coloured(ANSI.grey, ` [${defaultValue}]`) : '';
  return new Promise(resolve => {
    rl.question(`  ${question}${defaultHint}: `, answer => {
      const trimmed = answer.trim();
      resolve(trimmed !== '' ? trimmed : defaultValue);
    });
  });
}

/**
 * Ask a yes/no question. Returns true for yes.
 * @param {readline.Interface} rl
 * @param {string} question
 * @param {boolean} [defaultYes=true]
 * @returns {Promise<boolean>}
 */
async function askYN(rl, question, defaultYes = true) {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const answer = await ask(rl, `${question} ${coloured(ANSI.grey, `(${hint})`)}`, defaultYes ? 'y' : 'n');
  return /^y/i.test(answer);
}

/**
 * Ask a numbered menu question and return the chosen item.
 * @param {readline.Interface} rl
 * @param {string} question
 * @param {Array<{label: string, description?: string}>} choices
 * @param {number} [defaultIndex=0]
 * @returns {Promise<number>} Index of chosen item
 */
async function askMenu(rl, question, choices, defaultIndex = 0) {
  console.log('');
  console.log(`  ${coloured(ANSI.bold, question)}`);
  choices.forEach((c, i) => {
    const num    = coloured(ANSI.cyan, `${i + 1}.`);
    const label  = i === defaultIndex ? coloured(ANSI.bold, c.label) : c.label;
    const desc   = c.description ? coloured(ANSI.grey, `  — ${c.description}`) : '';
    console.log(`    ${num} ${label}${desc}`);
  });
  console.log('');

  while (true) {
    const answer = await ask(rl, `Choose (1-${choices.length})`, String(defaultIndex + 1));
    const n = parseInt(answer, 10);
    if (!isNaN(n) && n >= 1 && n <= choices.length) return n - 1;
    warn(`Please enter a number between 1 and ${choices.length}`);
  }
}

// ─────────────────────────────────────────────
// Wizard steps
// ─────────────────────────────────────────────

/**
 * Step 1 — CouchDB connection.
 * @param {readline.Interface} rl
 * @param {Object} defaults
 * @returns {Promise<Object>} vault config section
 */
async function stepVault(rl, defaults) {
  console.log('');
  header('Step 1 — CouchDB connection');
  console.log('');

  const protocol = await ask(rl, 'Protocol (http/https)', defaults.protocol);
  const host     = await ask(rl, 'Host', defaults.host);
  const port     = parseInt(await ask(rl, 'Port', String(defaults.port)), 10);
  const database = await ask(rl, 'Database', defaults.database);
  const username = await ask(rl, 'Username', defaults.username || '');
  const password = await ask(rl, 'Password (stored in plain text in config)', defaults.password || '');

  const vaultConfig = { host, port, database, username, password, protocol };

  // Test connection
  const doTest = await askYN(rl, 'Test connection now?', true);
  if (doTest) {
    const spin = require('./helpers').spinner('Connecting…');
    try {
      const vault = new VaultClient(vaultConfig);
      await vault.ping();
      spin.stop(success('Connection successful!') || '');
    } catch (err) {
      spin.stop('');
      warn(`Connection failed: ${err.message}`);
      const cont = await askYN(rl, 'Continue anyway?', false);
      if (!cont) {
        error('Aborted.');
        process.exit(1);
      }
    }
  }

  return vaultConfig;
}

/**
 * Step 2 — Folder structure preset.
 * @param {readline.Interface} rl
 * @param {Object} defaults
 * @returns {Promise<Object>} structure config section
 */
async function stepStructure(rl, defaults) {
  console.log('');
  header('Step 2 — Folder structure');

  const presetDescriptions = {
    para:          'Projects / Areas / Resources / Archives',
    zettelkasten:  'Slipbox / References / Projects / Archives',
    'johnny-decimal': 'Numeric category system (you define the categories)',
    flat:          'Everything in one folder — simple and fast',
    custom:        'Define your own folders'
  };

  const choices = VALID_PRESETS.map(p => ({
    label: p,
    description: presetDescriptions[p] || ''
  }));

  const defaultIdx = VALID_PRESETS.indexOf(defaults.preset) >= 0
    ? VALID_PRESETS.indexOf(defaults.preset) : 0;

  const chosen = await askMenu(rl, 'Choose a folder structure preset:', choices, defaultIdx);
  const preset = VALID_PRESETS[chosen];

  // Show the preset folders
  const presetFolders = PRESET_FOLDERS[preset] || {};
  if (Object.keys(presetFolders).length) {
    console.log('');
    muted('  Default folders for this preset:');
    for (const [role, folder] of Object.entries(presetFolders)) {
      muted(`    ${role.padEnd(12)} → ${folder}`);
    }
  }

  // Allow customisation
  const customise = await askYN(rl, 'Customise folder names?', false);
  const folders = Object.assign({}, presetFolders);

  if (customise) {
    console.log('');
    info('Enter custom name or press Enter to keep the default.');
    for (const [role, defaultFolder] of Object.entries(presetFolders)) {
      const custom = await ask(rl, `  ${role}`, defaultFolder);
      folders[role] = custom;
    }
  }

  // Extra custom folders
  const addExtra = await askYN(rl, 'Add extra top-level folders?', false);
  const customFolders = [];
  if (addExtra) {
    info('Enter folder names one per line. Empty line when done.');
    while (true) {
      const f = await ask(rl, '  Folder name (empty to stop)', '');
      if (!f) break;
      customFolders.push(f);
    }
  }

  return {
    preset,
    folders,
    customFolders,
    rootExceptions: defaults.rootExceptions || DEFAULTS.structure.rootExceptions,
    systemPaths:    defaults.systemPaths    || DEFAULTS.structure.systemPaths
  };
}

/**
 * Step 3 — AI provider.
 * @param {readline.Interface} rl
 * @param {Object} defaults
 * @returns {Promise<Object>} ai config section
 */
async function stepAI(rl, defaults) {
  console.log('');
  header('Step 3 — AI provider');

  const providerDescriptions = {
    none:       'No AI — rule-based features only',
    openai:     'OpenAI (GPT-4o, GPT-4, etc.)',
    anthropic:  'Anthropic (Claude models)',
    ollama:     'Ollama — local/private AI models',
    custom:     'Custom OpenAI-compatible endpoint'
  };

  // openclaw is a special internal provider; hide from wizard unless already set
  const displayProviders = VALID_PROVIDERS.filter(p => p !== 'openclaw');

  const choices = displayProviders.map(p => ({
    label: p,
    description: providerDescriptions[p] || ''
  }));

  const defaultIdx = Math.max(displayProviders.indexOf(defaults.provider), 0);
  const chosen = await askMenu(rl, 'Choose an AI provider:', choices, defaultIdx);
  const provider = displayProviders[chosen];

  if (provider === 'none') {
    return { provider: 'none', model: null, apiKey: null, baseUrl: null };
  }

  console.log('');

  // Model defaults per provider
  const modelDefaults = {
    openai:    'gpt-4o-mini',
    anthropic: 'claude-haiku-4-5-20251001',
    ollama:    'llama3',
    custom:    ''
  };

  const model  = await ask(rl, 'Model', defaults.model || modelDefaults[provider] || '');
  const apiKey = await ask(rl, 'API key', defaults.apiKey || '');
  let baseUrl  = null;

  if (provider === 'ollama' || provider === 'custom') {
    baseUrl = await ask(rl, 'Base URL', defaults.baseUrl || 'http://localhost:11434');
  }

  // Quick smoke test
  if (apiKey || provider === 'ollama') {
    const doTest = await askYN(rl, 'Test AI connection with a quick prompt?', true);
    if (doTest) {
      try {
        const createAIAdapter = require('../ai/index');
        const adapter = createAIAdapter({ ai: { provider, model, apiKey, baseUrl } });
        const spin = require('./helpers').spinner('Testing AI…');
        const response = await adapter.complete([
          { role: 'user', content: 'Reply with only the word OK.' }
        ]);
        spin.stop('');
        success(`AI responded: ${(response || '').trim().slice(0, 80)}`);
      } catch (err) {
        warn(`AI test failed: ${err.message}`);
        const cont = await askYN(rl, 'Continue anyway?', true);
        if (!cont) {
          error('Aborted.');
          process.exit(1);
        }
      }
    }
  }

  return { provider, model: model || null, apiKey: apiKey || null, baseUrl: baseUrl || null };
}

/**
 * Step 4 — Task projects (optional).
 * @param {readline.Interface} rl
 * @param {Object} defaults
 * @returns {Promise<Object>} tasks config section
 */
async function stepTasks(rl, defaults) {
  console.log('');
  header('Step 4 — Task projects (optional)');
  muted('  Projects let you group tasks by keyword and assign priorities.');

  const configure = await askYN(rl, 'Configure task projects now?', false);
  if (!configure) {
    return {
      folder:          defaults.folder          || DEFAULTS.tasks.folder,
      projects:        defaults.projects        || {},
      defaultPriority: defaults.defaultPriority || DEFAULTS.tasks.defaultPriority
    };
  }

  const folder = await ask(rl, 'Tasks folder', defaults.folder || DEFAULTS.tasks.folder);
  const defaultPriority = await ask(rl, 'Default priority (low/normal/high)', defaults.defaultPriority || 'normal');

  const projects = Object.assign({}, defaults.projects || {});
  info('Add project definitions. Empty name to stop.');
  while (true) {
    const name = await ask(rl, '  Project name (empty to stop)', '');
    if (!name) break;
    const keywords = await ask(rl, `  Keywords for "${name}" (comma-separated)`, '');
    const priority = await ask(rl, `  Default priority for "${name}"`, 'normal');
    projects[name] = {
      keywords: keywords ? keywords.split(',').map(k => k.trim()).filter(Boolean) : [],
      priority
    };
    success(`  Added project: ${name}`);
  }

  return { folder, projects, defaultPriority };
}

// ─────────────────────────────────────────────
// Config writer
// ─────────────────────────────────────────────

const GLOBAL_CONFIG_DIR  = path.join(os.homedir(), '.obsidian-curator');
const GLOBAL_CONFIG_PATH = path.join(GLOBAL_CONFIG_DIR, 'config.json');

/**
 * Write the assembled config to ~/.obsidian-curator/config.json.
 * @param {Object} config
 */
function writeConfig(config) {
  if (!fs.existsSync(GLOBAL_CONFIG_DIR)) {
    fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

// ─────────────────────────────────────────────
// Main wizard entry point
// ─────────────────────────────────────────────

/**
 * Run the interactive setup wizard.
 * Writes config to ~/.obsidian-curator/config.json when done.
 *
 * @param {Object} [existingConfig] - Pre-loaded config to use as defaults (optional)
 * @returns {Promise<void>}
 */
async function runWizard(existingConfig = null) {
  const defaults = existingConfig || DEFAULTS;

  console.log('');
  console.log(coloured(ANSI.bold, '  obsidian-curator setup wizard'));
  console.log(coloured(ANSI.grey, '  ─────────────────────────────'));
  muted('  Press Enter to accept the default shown in [brackets].');
  muted('  Use Ctrl-C to abort at any time.');

  const rl = createRL();

  try {
    const vault     = await stepVault(rl,     defaults.vault     || DEFAULTS.vault);
    const structure = await stepStructure(rl, defaults.structure || DEFAULTS.structure);
    const ai        = await stepAI(rl,        defaults.ai        || DEFAULTS.ai);
    const tasks     = await stepTasks(rl,     defaults.tasks     || DEFAULTS.tasks);

    const config = {
      vault,
      structure,
      ai,
      tasks,
      tidy: defaults.tidy || DEFAULTS.tidy
    };

    console.log('');
    header('Configuration summary');
    console.log('');
    muted(`  Vault:      ${vault.protocol}://${vault.host}:${vault.port}/${vault.database}`);
    muted(`  Preset:     ${structure.preset}`);
    muted(`  AI:         ${ai.provider}${ai.model ? ' / ' + ai.model : ''}`);
    muted(`  Tasks:      ${tasks.folder}`);
    console.log('');

    const save = await askYN(rl, 'Save configuration?', true);
    rl.close();

    if (!save) {
      warn('Configuration not saved.');
      return;
    }

    writeConfig(config);
    console.log('');
    success(`Configuration saved to ${GLOBAL_CONFIG_PATH}`);
    info('Run `obsidian-curator capture "hello"` to test your setup.');

  } catch (err) {
    rl.close();
    if (err.code === 'ERR_USE_AFTER_CLOSE') return; // Ctrl-C
    throw err;
  }
}

module.exports = runWizard;
