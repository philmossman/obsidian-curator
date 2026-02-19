'use strict';

/**
 * process command — AI-enriched inbox processing.
 *
 * Usage:
 *   obsidian-curator process [--limit N] [--dry-run] [--force]
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
async function processCommand(args) {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    error(`Config error: ${err.message}`);
    muted('Run `obsidian-curator init` to set up your configuration.');
    process.exit(1);
  }

  if (config.ai.provider === 'none') {
    warn('Process requires AI — configure a provider with `obsidian-curator init`');
    muted('Available providers: openai, anthropic, ollama, custom');
    return;
  }

  const limit  = args.limit  ? parseInt(args.limit,  10) : 10;
  const dryRun = !!(args['dry-run'] || args.dryRun);
  const force  = !!(args.force);

  if (dryRun) info('Dry-run mode — no changes will be written');

  const spin = spinner('Connecting to vault…');
  let curator;
  try {
    const vault = new VaultClient(config.vault);
    const ai    = createAIAdapter(config);
    curator     = new Curator({ vault, ai, config });
    spin.stop();
  } catch (err) {
    spin.stop(error(`Connection failed: ${err.message}`));
    process.exit(1);
  }

  const spin2 = spinner('Processing inbox…');
  let results;
  try {
    results = await curator.process({ limit, dryRun, force });
    spin2.stop();
  } catch (err) {
    spin2.stop();
    error(`Process failed: ${err.message}`);
    process.exit(1);
  }

  if (results.message) {
    warn(results.message);
    return;
  }

  header('\nInbox Processing Results');
  success(`Processed: ${results.processed}`);
  if (results.skipped) muted(`  Skipped (already processed): ${results.skipped}`);
  if (results.failed)  warn(`  Failed: ${results.failed}`);

  if (results.notes && results.notes.length) {
    console.log('');
    for (const note of results.notes) {
      if (note.status === 'success') {
        const ai = note.analysis || {};
        info(`  ${note.path}`);
        muted(`    → ${ai.folder || '?'}  [${(ai.tags || []).slice(0, 3).join(', ')}]  conf: ${ai.confidence || '?'}`);
        if (dryRun) muted('    (dry-run — not written)');
      } else {
        warn(`  ${note.path}: ${note.error}`);
      }
    }
  }
}

module.exports = processCommand;
