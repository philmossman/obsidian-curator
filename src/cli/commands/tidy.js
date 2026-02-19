'use strict';

/**
 * tidy command — vault housekeeping.
 *
 * Usage:
 *   obsidian-curator tidy [dupes|structure|stubs] [--dry-run]
 */

const { loadConfig } = require('../../core/config');
const { info, error, muted } = require('../helpers');

const VALID_CHECKS = ['dupes', 'structure', 'stubs'];

/**
 * @param {Object} args - Parsed arguments
 * @param {string[]} args._ - Optional check names
 * @returns {Promise<void>}
 */
async function tidyCommand(args) {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    error(`Config error: ${err.message}`);
    muted('Run `obsidian-curator init` to set up your configuration.');
    process.exit(1);
  }

  const checks = args._.length ? args._ : ['all'];
  const invalid = checks.filter(c => c !== 'all' && !VALID_CHECKS.includes(c));
  if (invalid.length) {
    error(`Unknown check(s): ${invalid.join(', ')}. Valid: ${VALID_CHECKS.join(', ')}`);
    process.exit(1);
  }

  const dryRun = args['dry-run'] || false;
  info(`Tidy not yet implemented (coming in Phase 3).`);
  muted(`Checks: ${checks.join(', ')}  Dry-run: ${dryRun}`);
}

module.exports = tidyCommand;
