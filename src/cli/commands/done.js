'use strict';

/**
 * done command — mark a task as done by search term.
 *
 * Usage:
 *   obsidian-curator done "search term"
 */

const { loadConfig } = require('../../core/config');
const { info, error, muted } = require('../helpers');

/**
 * @param {Object} args - Parsed arguments
 * @param {string[]} args._ - Search term words
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

  info('Task completion not yet implemented (coming in Phase 3).');
  muted(`Search term: ${searchTerm}`);
  muted(`Tasks folder: ${config.tasks.folder}`);
}

module.exports = doneCommand;
