'use strict';

/**
 * file command — AI-powered note routing.
 *
 * Usage:
 *   obsidian-curator file [--limit N] [--dry-run]
 */

const { loadConfig } = require('../../core/config');
const { info, warn, error, muted } = require('../helpers');

/**
 * @param {Object} args - Parsed arguments
 * @returns {Promise<void>}
 */
async function fileCommand(args) {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    error(`Config error: ${err.message}`);
    muted('Run `obsidian-curator init` to set up your configuration.');
    process.exit(1);
  }

  if (config.ai.provider === 'none') {
    warn('File routing requires AI — configure a provider with `obsidian-curator init`');
    muted('Available providers: openai, anthropic, ollama, custom');
    return;
  }

  info('File routing not yet implemented (coming in Phase 3).');
  muted(`Provider: ${config.ai.provider}  Model: ${config.ai.model || '(default)'}`);
}

module.exports = fileCommand;
