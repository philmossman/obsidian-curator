'use strict';

/**
 * task command — create a new task.
 *
 * Usage:
 *   obsidian-curator task "description of the task"
 */

const { loadConfig } = require('../../core/config');
const { info, error, muted } = require('../helpers');

/**
 * @param {Object} args - Parsed arguments
 * @param {string[]} args._ - Task description words
 * @returns {Promise<void>}
 */
async function taskCommand(args) {
  const description = args._.join(' ').trim();

  if (!description) {
    error('No description provided. Usage: obsidian-curator task "description"');
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

  info('Task creation not yet implemented (coming in Phase 3).');
  muted(`Description: ${description}`);
  muted(`Tasks folder: ${config.tasks.folder}`);
}

module.exports = taskCommand;
