'use strict';

/**
 * Curator — main orchestrator class.
 *
 * Wires together a VaultClient, an AI adapter, and configuration.
 * Each feature method delegates to its dedicated feature module.
 *
 * Usage:
 *   const { VaultClient, Curator, createAIAdapter, loadConfig } = require('obsidian-curator');
 *   const config = loadConfig();
 *   const vault  = new VaultClient(config.vault);
 *   const ai     = createAIAdapter(config);
 *   const curator = new Curator({ vault, ai, config });
 */

const { capture: captureNote }  = require('../features/capture');
const Processor                  = require('../features/processor');
const Filer                      = require('../features/filer');
const { StructureAuditor }       = require('../features/auditor');
const { runTidy }                = require('../features/tidy/executor');
const TaskStore                  = require('../features/tasks/store');
const { parseTask }              = require('../features/tasks/parser');
const { generateTaskBrief }      = require('../features/tasks/briefing');

class Curator {
  /**
   * @param {Object} deps
   * @param {import('./vault-client')} deps.vault - VaultClient instance
   * @param {import('../ai/adapter')}  deps.ai    - AIAdapter instance
   * @param {Object}                  deps.config - Loaded curator config
   */
  constructor({ vault, ai, config }) {
    if (!vault)  throw new Error('Curator requires a vault (VaultClient instance)');
    if (!config) throw new Error('Curator requires a config object');

    this.vault  = vault;
    this.ai     = ai || null;
    this.config = config;

    // Lazy-initialised feature instances
    this._processor  = null;
    this._filer      = null;
    this._taskStore  = null;
  }

  // ─────────────────────────────────────────────
  // Quick capture (no AI required)
  // ─────────────────────────────────────────────

  /**
   * Capture raw text to the inbox with timestamp frontmatter.
   * @param {string} text - Content to capture
   * @param {Object} [options]
   * @param {string} [options.source='cli']
   * @returns {Promise<string>} Path of the created note
   */
  async capture(text, options = {}) {
    return captureNote(this.vault, this.config, text, options);
  }

  // ─────────────────────────────────────────────
  // Process (AI)
  // ─────────────────────────────────────────────

  /**
   * Enrich inbox notes with AI-generated frontmatter (tags, summary, folder).
   * @param {Object} [options]
   * @param {number}  [options.limit=10]
   * @param {boolean} [options.dryRun=false]
   * @param {boolean} [options.force=false] - Re-process already-processed notes
   * @returns {Promise<Object>} Results summary
   */
  async process(options = {}) {
    if (!this._processor) {
      this._processor = new Processor(this.vault, this.ai, this.config);
    }
    return this._processor.processInbox(options);
  }

  // ─────────────────────────────────────────────
  // File (AI)
  // ─────────────────────────────────────────────

  /**
   * Route processed inbox notes to their correct vault folders.
   * @param {Object} [options]
   * @param {number}  [options.limit=10]
   * @param {number}  [options.minConfidence=0.7]
   * @param {boolean} [options.dryRun=false]
   * @param {string}  [options.sessionId]
   * @returns {Promise<Object>} Results summary
   */
  async file(options = {}) {
    if (!this._filer) {
      this._filer = new Filer(this.vault, this.ai, this.config);
    }
    return this._filer.fileNotes(options);
  }

  // ─────────────────────────────────────────────
  // Audit (no AI required)
  // ─────────────────────────────────────────────

  /**
   * Check vault structure against configured canonical folders.
   * @param {Object} [options]
   * @returns {Promise<Object>} Audit report
   */
  async audit(options = {}) {
    const auditor = new StructureAuditor(this.vault, this.config);
    return auditor.analyze();
  }

  // ─────────────────────────────────────────────
  // Tidy (AI optional)
  // ─────────────────────────────────────────────

  /**
   * Vault housekeeping: detect and optionally fix duplicates, structure
   * violations, and dead notes.
   * @param {Object}   [options]
   * @param {string[]} [options.checks=['all']] - ['dupes','structure','stubs'] or ['all']
   * @param {boolean}  [options.dryRun=false]
   * @param {string}   [options.sessionId]
   * @returns {Promise<Object>} Tidy report with issues and actions taken
   */
  async tidy(options = {}) {
    return runTidy(this.vault, this.ai, this.config, options);
  }

  // ─────────────────────────────────────────────
  // Tasks (no AI required)
  // ─────────────────────────────────────────────

  /**
   * List open tasks from the configured tasks folder.
   * @param {Object} [options]
   * @param {string} [options.status]   - Filter by status ('open' | 'done')
   * @param {string} [options.project]  - Filter by project
   * @param {string} [options.priority] - Filter by priority
   * @returns {Promise<Array>} Array of task objects
   */
  async tasks(options = {}) {
    const store = this._getTaskStore();
    return store.listTasks(options);
  }

  /**
   * Create a new task from natural language text.
   * @param {string} text   - Natural language task description
   * @returns {Promise<Object>} Created task { path, title, due, project, priority, status }
   */
  async createTask(text) {
    if (!text || !text.trim()) {
      throw new Error('createTask() requires non-empty text');
    }
    const parsed = parseTask(text.trim(), this.config);
    const store  = this._getTaskStore();
    return store.createTask({ ...parsed, source: 'cli' });
  }

  /**
   * Mark a task as complete by search term or exact path.
   * @param {string} search - Partial title or exact vault path
   * @returns {Promise<Object>} { ok, task, message }
   */
  async completeTask(search) {
    if (!search || !search.trim()) {
      throw new Error('completeTask() requires a search term');
    }
    const store = this._getTaskStore();
    return store.completeTask(search.trim());
  }

  /**
   * Generate a formatted task briefing (for daily summaries).
   * @returns {Promise<string>} Markdown-formatted task brief
   */
  async taskBrief() {
    const store = this._getTaskStore();
    return generateTaskBrief(store);
  }

  // ─────────────────────────────────────────────
  // Static helpers (kept for backwards-compat & tests)
  // ─────────────────────────────────────────────

  /**
   * Slugify the first few words of a string for use in filenames.
   * @param {string} text
   * @param {number} [maxWords=6]
   * @returns {string}
   */
  static _slugify(text, maxWords = 6) {
    return text
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, maxWords)
      .join('-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
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
  // Private helpers
  // ─────────────────────────────────────────────

  _getTaskStore() {
    if (!this._taskStore) {
      this._taskStore = new TaskStore(this.vault, this.config);
    }
    return this._taskStore;
  }
}

module.exports = Curator;
