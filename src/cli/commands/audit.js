'use strict';

/**
 * audit command — vault structure validation.
 *
 * Usage:
 *   obsidian-curator audit [--json]
 */

const { loadConfig }   = require('../../core/config');
const VaultClient       = require('../../core/vault-client');
const Curator           = require('../../core/curator');
const { info, warn, error, success, muted, spinner, header, ANSI, coloured } = require('../helpers');

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

  const asJson = !!(args.json || args.j);

  const spin = spinner('Connecting to vault…');
  let curator;
  try {
    const vault = new VaultClient(config.vault);
    curator     = new Curator({ vault, ai: null, config });
    spin.stop();
  } catch (err) {
    spin.stop();
    error(`Connection failed: ${err.message}`);
    process.exit(1);
  }

  const spin2 = spinner('Auditing vault structure…');
  let report;
  try {
    report = await curator.audit();
    spin2.stop();
  } catch (err) {
    spin2.stop();
    error(`Audit failed: ${err.message}`);
    process.exit(1);
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  header('\nVault Audit Report');
  const s = report.summary;
  info(`Notes: ${s.totalNotes}   Folders: ${s.totalFolders}`);
  if (s.detectedMethodology) {
    const dm = s.detectedMethodology;
    muted(`Detected system: ${dm.method.name}  (${dm.confidence} confidence)`);
  }

  // ── Issues ─────────────────────────────────────────────────────────────────
  if (report.issues.length === 0) {
    success('\nNo structural issues found.');
  } else {
    console.log('');
    header(`Issues (${report.issues.length}):`);
    for (const issue of report.issues) {
      const icon = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢';
      console.log(`${icon} [${issue.category}] ${issue.issue}`);
      muted(`   ${issue.detail}`);
      info(`   → ${issue.recommendation}`);
    }
  }

  // ── Recommendations ────────────────────────────────────────────────────────
  if (report.recommendations.length > 0) {
    console.log('');
    header(`Recommendations (${report.recommendations.length}):`);
    for (const rec of report.recommendations) {
      const icon = rec.priority === 'high' ? '⚡' : rec.priority === 'medium' ? '•' : '·';
      console.log(`${icon} ${rec.title}`);
      muted(`  ${rec.detail}`);
      info(`  Action: ${rec.action}`);
    }
  }

  // ── Structure overview ─────────────────────────────────────────────────────
  if (report.structure && report.structure.topLevel.length > 0) {
    console.log('');
    header('Top-level folders:');
    for (const f of report.structure.topLevel.slice(0, 10)) {
      muted(`  ${f.folder.padEnd(30)} ${f.total} notes  (${f.percentage}%)`);
    }
    if (report.structure.topLevel.length > 10) {
      muted(`  ... and ${report.structure.topLevel.length - 10} more`);
    }
  }
}

module.exports = auditCommand;
