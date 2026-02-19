'use strict';

/**
 * done command — mark a task as done by search term.
 *
 * Usage:
 *   obsidian-curator done "search term"
 */

const { loadConfig }   = require('../../core/config');
const VaultClient       = require('../../core/vault-client');
const Curator           = require('../../core/curator');
const { info, error, success, muted, warn } = require('../helpers');

/**
 * @param {Object} args - Parsed arguments
 * @returns {Promise<void>}
 */
async function doneCommand(args) {
  const searchTerm = args._.join(' ').trim();

  if (!searchTerm) {
    error('No search term provided. Usage: obsidian-curator done "search term"');
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

  let curator;
  try {
    const vault = new VaultClient(config.vault);
    curator     = new Curator({ vault, ai: null, config });
  } catch (err) {
    error(`Connection failed: ${err.message}`);
    process.exit(1);
  }

  let result;
  try {
    result = await curator.completeTask(searchTerm);
  } catch (err) {
    error(`Failed to complete task: ${err.message}`);
    process.exit(1);
  }

  if (result.ok) {
    success(result.message);
    if (result.task) {
      muted(`  Path: ${result.task.path}`);
      muted(`  Completed: ${result.task.completed}`);
    }
  } else {
    warn(result.message);
    muted('Try a different search term or check `obsidian-curator tasks`');
  }
}

module.exports = doneCommand;
