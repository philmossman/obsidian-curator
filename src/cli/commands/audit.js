'use strict';

/**
 * audit command — vault structure validation.
 *
 * Usage:
 *   obsidian-curator audit
 */

const { loadConfig } = require('../../core/config');
const { info, error, muted } = require('../helpers');

/**
 * @param {Object} args - Parsed arguments
 * @returns {Promise<void>}
 */
async function auditCommand(args) {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    error(`Config error: ${err.message}`);
    muted('Run `obsidian-curator init` to set up your configuration.');
    process.exit(1);
  }

  info('Audit not yet implemented (coming in Phase 3).');
  muted(`Preset: ${config.structure.preset}`);
}

module.exports = auditCommand;
