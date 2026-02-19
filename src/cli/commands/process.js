'use strict';

/**
 * process command — AI-enriched inbox processing.
 *
 * Usage:
 *   obsidian-curator process [--limit N] [--dry-run] [--force]
 */

const { loadConfig } = require('../../core/config');
const { info, warn, error, muted } = require('../helpers');

/**
 * @param {Object} args - Parsed arguments
 * @returns {Promise<void>}
 */
async function processCommand(args) {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    error(`Config error: ${err.message}`);
    muted('Run `obsidian-curator init` to set up your configuration.');
    process.exit(1);
  }

  if (config.ai.provider === 'none') {
    warn('Process requires AI — configure a provider with `obsidian-curator init`');
    muted('Available providers: openai, anthropic, ollama, custom');
    return;
  }

  info('Process not yet implemented (coming in Phase 3).');
  muted(`Provider: ${config.ai.provider}  Model: ${config.ai.model || '(default)'}`);
}

module.exports = processCommand;
