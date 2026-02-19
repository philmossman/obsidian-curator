'use strict';

/**
 * Processor — AI-enriched inbox note processing.
 *
 * Reads inbox notes, uses the AI adapter to suggest tags, a summary,
 * and a destination folder, then writes enriched frontmatter back to
 * the note (still in inbox — filing is a separate step).
 *
 * Requires an AI adapter. Without AI the processor is a no-op.
 */

const path = require('path');
const { buildNoteAnalysisPrompt } = require('./prompts');
const { getCanonicalFolders } = require('../core/config');

class Processor {
  /**
   * @param {Object} vault  - VaultClient instance
   * @param {Object} ai     - AIAdapter instance (may be null/NoneAdapter)
   * @param {Object} config - Loaded curator config
   */
  constructor(vault, ai, config) {
    if (!vault)  throw new Error('Processor requires a vault (VaultClient instance)');
    if (!config) throw new Error('Processor requires config');
    this.vault  = vault;
    this.ai     = ai   || null;
    this.config = config;
  }

  /**
   * Process inbox notes with AI analysis.
   *
   * @param {Object}  [options]
   * @param {number}  [options.limit=10]    - Max notes to process
   * @param {boolean} [options.dryRun=false]
   * @param {boolean} [options.force=false] - Re-process already-processed notes
   * @returns {Promise<Object>} { processed, skipped, failed, notes }
   */
  async processInbox(options = {}) {
    const {
      limit   = 10,
      dryRun  = false,
      force   = false
    } = options;

    if (!this.ai || this.ai.constructor.name === 'NoneAdapter') {
      return {
        processed: 0, skipped: 0, failed: 0, notes: [],
        message: 'AI adapter is required for processing. Configure a provider.'
      };
    }

    const inboxFolder = (this.config.structure && this.config.structure.folders && this.config.structure.folders.inbox) || 'inbox';
    const allNotes    = await this.vault.listNotes();
    const inboxNotes  = allNotes.filter(n => n.path.startsWith(inboxFolder + '/') || n.path.startsWith(inboxFolder));

    // Build vault structure context for the prompt
    const vaultStructure = await this._buildVaultStructure(allNotes);
    const canonicalFolders = getCanonicalFolders(this.config);

    const results = { processed: 0, skipped: 0, failed: 0, notes: [] };
    let count = 0;

    for (const noteInfo of inboxNotes) {
      if (count >= limit) break;

      try {
        const note = await this.vault.readNote(noteInfo.path);
        if (!note) { results.skipped++; continue; }

        const { frontmatter, body } = this.vault.parseFrontmatter(note.content);

        if (frontmatter.processed && !force) {
          results.skipped++;
          continue;
        }

        // Analyse with AI
        const analysis = await this._analyseNote({ path: note.path, body, frontmatter }, vaultStructure, canonicalFolders);

        const updatedFrontmatter = {
          ...frontmatter,
          processed:    true,
          processed_at: new Date().toISOString(),
          ai_suggestions: {
            folder:     analysis.folder     || inboxFolder,
            tags:       analysis.tags       || [],
            related:    analysis.related    || [],
            summary:    analysis.summary    || '',
            confidence: analysis.confidence || 'low'
          }
        };

        const updatedContent = this.vault.buildNote(updatedFrontmatter, body);

        if (!dryRun) {
          await this.vault.writeNote(note.path, updatedContent);
        }

        results.processed++;
        results.notes.push({ path: note.path, analysis, status: 'success', dryRun });
        count++;

      } catch (err) {
        results.failed++;
        results.notes.push({ path: noteInfo.path, error: err.message, status: 'failed' });
      }
    }

    return results;
  }

  /**
   * Analyse a single note with the AI adapter.
   * @private
   */
  async _analyseNote(note, vaultStructure, canonicalFolders) {
    const prompt = buildNoteAnalysisPrompt(note, vaultStructure, canonicalFolders);

    const schema = {
      type: 'object',
      properties: {
        folder:     { type: 'string' },
        tags:       { type: 'array', items: { type: 'string' } },
        related:    { type: 'array', items: { type: 'string' } },
        summary:    { type: 'string' },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] }
      },
      required: ['folder', 'tags', 'summary', 'confidence']
    };

    const result = await this.ai.structured(prompt, schema, { temperature: 0.3 });
    if (!result) throw new Error('AI returned no analysis result');
    return result;
  }

  /**
   * Build a lightweight vault structure object for AI context.
   * @private
   */
  async _buildVaultStructure(allNotes) {
    const folderCounts = {};
    for (const note of allNotes) {
      const folderPath = path.dirname(note.path);
      if (folderPath && folderPath !== '.') {
        folderCounts[folderPath] = (folderCounts[folderPath] || 0) + 1;
      }
    }

    return {
      folders: Object.entries(folderCounts)
        .map(([p, count]) => ({ path: p, count }))
        .sort((a, b) => b.count - a.count),
      noteCount: allNotes.length,
      updated:   new Date().toISOString()
    };
  }
}

module.exports = Processor;
