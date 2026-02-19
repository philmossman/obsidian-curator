'use strict';

/**
 * Curator — main orchestrator class.
 *
 * Wires together a VaultClient, an AI adapter, and configuration.
 * Feature methods are stubbed here; full implementations come in Phase 3.
 *
 * Usage:
 *   const { VaultClient, Curator, createAIAdapter, loadConfig } = require('obsidian-curator');
 *   const config = loadConfig();
 *   const vault  = new VaultClient(config.vault);
 *   const ai     = createAIAdapter(config);
 *   const curator = new Curator({ vault, ai, config });
 */

class Curator {
  /**
   * @param {Object} deps
   * @param {import('./vault-client')} deps.vault - VaultClient instance
   * @param {import('../ai/adapter')}  deps.ai    - AIAdapter instance
   * @param {Object}                  deps.config - Loaded curator config
   */
  constructor({ vault, ai, config }) {
    if (!vault) throw new Error('Curator requires a vault (VaultClient instance)');
    if (!config) throw new Error('Curator requires a config object');

    this.vault = vault;
    this.ai = ai || null;
    this.config = config;
  }

  // ─────────────────────────────────────────────
  // Phase 2: Quick capture
  // ─────────────────────────────────────────────

  /**
   * Capture raw text to the inbox with timestamp frontmatter.
   * @param {string} text - Content to capture
   * @param {Object} [options]
   * @param {string} [options.source='cli']
   * @returns {Promise<string>} Path of the created note
   */
  async capture(text, options = {}) {
    if (!text || !text.trim()) {
      throw new Error('capture() requires non-empty text');
    }

    const source = options.source || 'cli';
    const now    = new Date();

    // Build filename: slugified first 6 words + ISO timestamp
    const slug = Curator._slugify(text);
    const ts   = Curator._isoStamp(now);        // e.g. 20240315-143022
    const inboxFolder = (this.config.structure && this.config.structure.folders && this.config.structure.folders.inbox) || 'inbox';
    const notePath = `${inboxFolder}/${slug}-${ts}.md`;

    const frontmatter = {
      created: now.toISOString(),
      source,
      tags: []
    };

    const content = this.vault.buildNote(frontmatter, text);
    await this.vault.writeNote(notePath, content);

    return notePath;
  }

  /**
   * Slugify the first few words of a string for use in filenames.
   * Strips non-alphanumeric chars, lower-cases, joins with hyphens.
   * @param {string} text
   * @param {number} [maxWords=6]
   * @returns {string}
   */
  static _slugify(text, maxWords = 6) {
    return text
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')   // keep alphanumeric, spaces, hyphens
      .trim()
      .split(/\s+/)
      .slice(0, maxWords)
      .join('-')
      .replace(/-+/g, '-')             // collapse multiple hyphens
      .replace(/^-|-$/g, '')           // trim leading/trailing hyphens
      || 'note';
  }

  /**
   * Format a Date as a compact timestamp string suitable for filenames.
   * e.g. 20240315-143022
   * @param {Date} date
   * @returns {string}
   */
  static _isoStamp(date) {
    const pad = n => String(n).padStart(2, '0');
    return (
      `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
      `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
    );
  }

  // ─────────────────────────────────────────────
  // Phase 3: Process (AI)
  // ─────────────────────────────────────────────

  /**
   * Enrich inbox notes with AI-generated frontmatter (tags, summary, folder).
   * @param {Object} [options]
   * @param {number} [options.limit=10]
   * @param {boolean} [options.dryRun=false]
   * @param {boolean} [options.force=false] - Re-process already-processed notes
   * @returns {Promise<Object>} Results summary
   */
  async process(options = {}) {
    throw new Error('process() not yet implemented — coming in Phase 3');
  }

  // ─────────────────────────────────────────────
  // Phase 3: File (AI)
  // ─────────────────────────────────────────────

  /**
   * Route processed inbox notes to their correct vault folders.
   * @param {Object} [options]
   * @param {number} [options.limit=10]
   * @param {number} [options.minConfidence=0.7]
   * @param {boolean} [options.dryRun=false]
   * @returns {Promise<Object>} Results summary
   */
  async file(options = {}) {
    throw new Error('file() not yet implemented — coming in Phase 3');
  }

  // ─────────────────────────────────────────────
  // Phase 3: Audit
  // ─────────────────────────────────────────────

  /**
   * Check vault structure against configured canonical folders.
   * @param {Object} [options]
   * @returns {Promise<Object>} Audit report
   */
  async audit(options = {}) {
    throw new Error('audit() not yet implemented — coming in Phase 3');
  }

  // ─────────────────────────────────────────────
  // Phase 3: Tidy
  // ─────────────────────────────────────────────

  /**
   * Vault housekeeping: detect and optionally fix duplicates, structure
   * violations, and dead notes.
   * @param {Object} [options]
   * @param {string[]} [options.checks=['all']] - ['dupes','structure','stubs'] or ['all']
   * @param {boolean}  [options.dryRun=false]
   * @returns {Promise<Object>} Tidy report with issues and actions taken
   */
  async tidy(options = {}) {
    throw new Error('tidy() not yet implemented — coming in Phase 3');
  }

  // ─────────────────────────────────────────────
  // Phase 3: Tasks
  // ─────────────────────────────────────────────

  /**
   * List open tasks from the configured tasks folder.
   * @param {Object} [options]
   * @returns {Promise<Array>} Array of task objects
   */
  async tasks(options = {}) {
    throw new Error('tasks() not yet implemented — coming in Phase 3');
  }
}

module.exports = Curator;
