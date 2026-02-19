'use strict';

/**
 * tasks command — list open tasks.
 *
 * Usage:
 *   obsidian-curator tasks [--project X] [--priority high]
 */

const { loadConfig } = require('../../core/config');
const { info, error, muted } = require('../helpers');

/**
 * @param {Object} args - Parsed arguments
 * @param {string} [args.project] - Filter by project
 * @param {string} [args.priority] - Filter by priority
 * @returns {Promise<void>}
 */
async function tasksCommand(args) {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    error(`Config error: ${err.message}`);
    muted('Run `obsidian-curator init` to set up your configuration.');
    process.exit(1);
  }

  info('Tasks listing not yet implemented (coming in Phase 3).');
  muted(`Tasks folder: ${config.tasks.folder}`);
  if (args.project) muted(`  Filter: project = ${args.project}`);
  if (args.priority) muted(`  Filter: priority = ${args.priority}`);
}

module.exports = tasksCommand;
