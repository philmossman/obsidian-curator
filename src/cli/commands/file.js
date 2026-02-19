'use strict';

/**
 * file command — AI-powered note routing from inbox to canonical folders.
 *
 * Usage:
 *   obsidian-curator file [--limit N] [--dry-run] [--min-confidence 0.7]
 */

const { loadConfig }       = require('../../core/config');
const createAIAdapter       = require('../../ai/index');
const VaultClient           = require('../../core/vault-client');
const Curator               = require('../../core/curator');
const { info, warn, error, success, muted, spinner, header } = require('../helpers');

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

  const limit         = args.limit            ? parseInt(args.limit, 10) : 10;
  const dryRun        = !!(args['dry-run']    || args.dryRun);
  const minConfidence = args['min-confidence'] ? parseFloat(args['min-confidence']) : 0.7;

  if (dryRun) info('Dry-run mode — no notes will be moved');

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

  const spin2 = spinner('Filing notes…');
  let results;
  try {
    results = await curator.file({ limit, dryRun, minConfidence });
    spin2.stop();
  } catch (err) {
    spin2.stop();
    error(`Filing failed: ${err.message}`);
    process.exit(1);
  }

  if (results.message) {
    warn(results.message);
    return;
  }

  header('\nFiling Results');
  if (!dryRun) muted(`  Session ID: ${results.sessionId}  (use for undo)`);
  success(`Filed:   ${results.filed}`);
  if (results.queued)  muted(`  Queued for review:  ${results.queued}`);
  if (results.skipped) muted(`  Skipped: ${results.skipped}`);
  if (results.failed)  warn(`  Failed:  ${results.failed}`);

  if (results.details && results.details.length) {
    console.log('');
    for (const d of results.details) {
      const icon = d.action === 'filed' ? '→' : d.action === 'queued' ? '⏸' : '✗';
      if (d.action === 'filed') {
        info(`  ${icon} ${d.path}`);
        muted(`       → ${d.targetPath}${dryRun ? '  (preview)' : ''}`);
      } else if (d.action === 'queued') {
        warn(`  ${icon} ${d.path}  (low confidence — queued)`);
      } else if (d.action === 'failed') {
        error(`  ${icon} ${d.path}: ${d.error}`);
      }
    }
  }
}

module.exports = fileCommand;
