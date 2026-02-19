'use strict';

/**
 * capture command — quick-capture text to the vault inbox.
 *
 * Usage:
 *   obsidian-curator capture "my note text"
 *   obsidian-curator capture some words without quotes
 */

const { loadConfig } = require('../../core/config');
const VaultClient    = require('../../core/vault-client');
const Curator        = require('../../core/curator');
const { success, error, muted } = require('../helpers');

/**
 * @param {Object} args - Parsed arguments (from parseArgs)
 * @param {string[]} args._ - Positional args; joined as capture text
 * @returns {Promise<void>}
 */
async function captureCommand(args) {
  const text = args._.join(' ').trim();

  if (!text) {
    error('No text provided. Usage: obsidian-curator capture "your note text"');
    process.exit(1);
  }

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    error(`Config error: ${err.message}`);
    muted('Run `obsidian-curator init` to set up your configuration.');
    process.exit(1);
  }

  const vault = new VaultClient(config.vault);
  const curator = new Curator({ vault, ai: null, config });

  try {
    const source = args.source || 'cli';
    const notePath = await curator.capture(text, { source });
    success(`Captured to ${notePath}`);
  } catch (err) {
    error(`Capture failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = captureCommand;
