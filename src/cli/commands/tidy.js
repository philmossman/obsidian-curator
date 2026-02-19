'use strict';

/**
 * tidy command — vault housekeeping.
 *
 * Usage:
 *   obsidian-curator tidy [dupes|structure|stubs] [--dry-run]
 */

const { loadConfig }   = require('../../core/config');
const createAIAdapter   = require('../../ai/index');
const VaultClient       = require('../../core/vault-client');
const Curator           = require('../../core/curator');
const { info, warn, error, success, muted, spinner, header } = require('../helpers');

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

  const dryRun = !!(args['dry-run'] || args.dryRun);
  if (dryRun) info('Dry-run mode — no changes will be made');

  const spin = spinner('Connecting to vault…');
  let curator;
  try {
    const vault = new VaultClient(config.vault);
    const ai    = createAIAdapter(config);
    curator     = new Curator({ vault, ai, config });
    spin.stop();
  } catch (err) {
    spin.stop();
    error(`Connection failed: ${err.message}`);
    process.exit(1);
  }

  const spin2 = spinner(`Tidying vault (${checks.join(', ')})…`);
  let results;
  try {
    results = await curator.tidy({ checks, dryRun });
    spin2.stop();
  } catch (err) {
    spin2.stop();
    error(`Tidy failed: ${err.message}`);
    process.exit(1);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  header('\nTidy Results');
  muted(`Scanned: ${results.totalNotes} notes   Issues found: ${results.totalIssues}`);
  if (!dryRun && results.sessionId) muted(`Session: ${results.sessionId}  (use for undo)`);

  success(`Auto-fixed: ${results.autoFixed.length}`);
  if (results.aiFixed.length)  info(`AI-resolved: ${results.aiFixed.length}`);
  if (results.flagged.length)  warn(`Flagged for review: ${results.flagged.length}`);
  if (results.failed.length)   error(`Errors: ${results.failed.length}`);

  // ── Auto-fixed ─────────────────────────────────────────────────────────────
  if (results.autoFixed.length > 0) {
    console.log('');
    header('Auto-fixed:');
    for (const r of results.autoFixed) {
      const action = r.action === 'delete' ? '🗑  deleted' : `→ moved to ${r.targetPath}`;
      muted(`  ${r.path}  ${action}${dryRun ? ' (preview)' : ''}`);
    }
  }

  // ── AI-resolved ────────────────────────────────────────────────────────────
  if (results.aiFixed.length > 0) {
    console.log('');
    header('AI-resolved:');
    for (const r of results.aiFixed) {
      const action = r.action === 'delete' ? '🗑  deleted'
        : r.action === 'move'  ? `→ moved to ${r.targetPath}`
        : r.action === 'keep'  ? '✓ kept'
        : r.action;
      info(`  ${r.path}  ${action}${dryRun ? ' (preview)' : ''}`);
      if (r.aiReasoning) muted(`    reason: ${r.aiReasoning}`);
    }
  }

  // ── Flagged ────────────────────────────────────────────────────────────────
  if (results.flagged.length > 0) {
    console.log('');
    header('Flagged for manual review:');
    for (const r of results.flagged) {
      warn(`  ${r.path}`);
      muted(`    ${r.flagReason || r.reason}`);
    }
  }

  // ── Errors ─────────────────────────────────────────────────────────────────
  if (results.failed.length > 0) {
    console.log('');
    header('Errors:');
    for (const r of results.failed) {
      error(`  ${r.path}: ${r.error}`);
    }
  }
}

module.exports = tidyCommand;
