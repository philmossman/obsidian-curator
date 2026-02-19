'use strict';

/**
 * Filer — AI-powered note routing from inbox to canonical folders.
 *
 * Reads inbox notes that have been enriched by the Processor (have
 * ai_suggestions frontmatter), then moves each note to its correct
 * destination folder. Supports session-based undo.
 */

const path   = require('path');
const crypto = require('crypto');
const { getCanonicalFolders } = require('../core/config');
const { trackOperation }      = require('../core/undo');
const { buildFilingPrompt }   = require('./prompts');

class Filer {
  /**
   * @param {Object} vault  - VaultClient instance
   * @param {Object} ai     - AIAdapter instance
   * @param {Object} config - Loaded curator config
   */
  constructor(vault, ai, config) {
    if (!vault)  throw new Error('Filer requires a vault (VaultClient instance)');
    if (!config) throw new Error('Filer requires config');
    this.vault  = vault;
    this.ai     = ai   || null;
    this.config = config;
  }

  /**
   * File inbox notes based on their AI suggestions.
   *
   * @param {Object}  [options]
   * @param {number}  [options.limit=10]
   * @param {number}  [options.minConfidence=0.7]
   * @param {boolean} [options.dryRun=false]
   * @param {string}  [options.sessionId]  - Auto-generated if omitted
   * @returns {Promise<Object>} { sessionId, processed, filed, queued, skipped, failed, details, dryRun }
   */
  async fileNotes(options = {}) {
    const {
      limit         = 10,
      minConfidence = 0.7,
      dryRun        = false,
      sessionId     = Filer._generateSessionId()
    } = options;

    const results = {
      sessionId, processed: 0, filed: 0, queued: 0, skipped: 0, failed: 0,
      details: [], dryRun
    };

    if (!this.ai || this.ai.constructor.name === 'NoneAdapter') {
      results.message = 'AI adapter is required for filing. Configure a provider.';
      return results;
    }

    const inboxFolder      = (this.config.structure && this.config.structure.folders && this.config.structure.folders.inbox) || 'inbox';
    const canonicalFolders = getCanonicalFolders(this.config);

    // Gather processed inbox notes (have ai_suggestions)
    const inboxNotes = await this._getProcessedInboxNotes(inboxFolder);

    if (inboxNotes.length === 0) {
      results.message = 'No processed notes found in inbox. Run `process` first.';
      return results;
    }

    const toProcess = inboxNotes.slice(0, limit);

    for (const note of toProcess) {
      results.processed++;
      try {
        const result = await this._fileNote(note, { minConfidence, dryRun, sessionId, canonicalFolders });
        if      (result.action === 'filed')   results.filed++;
        else if (result.action === 'queued')  results.queued++;
        else if (result.action === 'skipped') results.skipped++;
        results.details.push(result);
      } catch (err) {
        results.failed++;
        results.details.push({ path: note.path, action: 'failed', error: err.message });
      }
    }

    return results;
  }

  /**
   * Get inbox notes that have been processed (have ai_suggestions).
   * @private
   */
  async _getProcessedInboxNotes(inboxFolder) {
    const allNotes    = await this.vault.listNotes();
    const inboxNotes  = allNotes.filter(n => n.path.startsWith(inboxFolder + '/') || n.path === inboxFolder);
    const processed   = [];

    for (const noteInfo of inboxNotes) {
      const note = await this.vault.readNote(noteInfo.path);
      if (!note) continue;
      const { frontmatter, body } = this.vault.parseFrontmatter(note.content);
      if (frontmatter.ai_suggestions) {
        processed.push({ path: note.path, frontmatter, body, content: note.content });
      }
    }

    return processed;
  }

  /**
   * File a single note.
   * @private
   */
  async _fileNote(note, options) {
    const { minConfidence, dryRun, sessionId, canonicalFolders } = options;
    const suggestions  = note.frontmatter.ai_suggestions;
    const confidence   = Filer._parseConfidence(suggestions.confidence);
    const inboxFolder  = (this.config.structure && this.config.structure.folders && this.config.structure.folders.inbox) || 'inbox';

    if (confidence < minConfidence) {
      return await this._queueForReview(note, dryRun, sessionId, inboxFolder);
    }

    // Determine target folder — ask AI to confirm/improve suggestion
    let targetFolder = suggestions.folder;
    try {
      const aiDecision = await this._askAIForFolder(note, canonicalFolders);
      if (aiDecision && aiDecision.targetFolder) {
        targetFolder = aiDecision.targetFolder;
      }
    } catch (_) {
      // Fall back to original suggestion
    }

    const fileName  = path.basename(note.path);
    const targetPath = path.join(targetFolder, fileName);

    // Resolve filename collisions
    const finalPath     = await this._resolveCollision(targetPath, dryRun);
    const updatedContent = this._buildUpdatedNote(note, suggestions);

    if (dryRun) {
      return {
        path: note.path, action: 'filed', targetPath: finalPath,
        tags: suggestions.tags || [], confidence: suggestions.confidence, preview: true
      };
    }

    await this.vault.writeNote(finalPath, updatedContent);
    await this.vault.deleteNote(note.path);

    await trackOperation(sessionId, {
      action:          'file',
      originalPath:    note.path,
      targetPath:      finalPath,
      timestamp:       Date.now(),
      originalContent: note.content,
      newContent:      updatedContent
    });

    return {
      path: note.path, action: 'filed', targetPath: finalPath,
      tags: suggestions.tags || [], confidence: suggestions.confidence
    };
  }

  /**
   * Queue a low-confidence note for manual review.
   * @private
   */
  async _queueForReview(note, dryRun, sessionId, inboxFolder) {
    const queuePath  = `${inboxFolder}/review-queue/${path.basename(note.path)}`;
    const fm         = { ...note.frontmatter, review_needed: true, queued_at: new Date().toISOString() };
    const updContent = this.vault.buildNote(fm, note.body);

    if (dryRun) {
      return { path: note.path, action: 'queued', targetPath: queuePath, reason: 'Low confidence', preview: true };
    }

    await this.vault.writeNote(queuePath, updContent);
    await this.vault.deleteNote(note.path);

    await trackOperation(sessionId, {
      action:          'queue',
      originalPath:    note.path,
      targetPath:      queuePath,
      timestamp:       Date.now(),
      originalContent: note.content,
      newContent:      updContent
    });

    return {
      path: note.path, action: 'queued', targetPath: queuePath,
      reason: 'Low confidence', confidence: note.frontmatter.ai_suggestions?.confidence
    };
  }

  /**
   * Ask AI to confirm / improve the target folder.
   * @private
   */
  async _askAIForFolder(note, canonicalFolders) {
    const prompt  = buildFilingPrompt(note, canonicalFolders);
    const schema  = {
      type: 'object',
      properties: {
        targetFolder: { type: 'string' },
        reasoning:    { type: 'string' },
        confidence:   { type: 'number' }
      },
      required: ['targetFolder']
    };
    return await this.ai.structured(prompt, schema, { temperature: 0.2 });
  }

  /**
   * Build an updated note with tags applied and ai_suggestions removed.
   * @private
   */
  _buildUpdatedNote(note, suggestions) {
    const fm = { ...note.frontmatter };

    if (suggestions.tags && suggestions.tags.length > 0) fm.tags = suggestions.tags;
    fm.filed_at  = new Date().toISOString();
    fm.filed_by  = 'obsidian-curator';
    delete fm.ai_suggestions;

    let body = note.body;
    if (suggestions.related && suggestions.related.length > 0) {
      const backlinks = suggestions.related
        .map(p => `[[${p.replace(/\.md$/, '')}]]`)
        .join(' ');
      body = body + '\n\n## Related Notes\n' + backlinks;
    }

    return this.vault.buildNote(fm, body);
  }

  /**
   * Resolve filename collision by appending a numeric suffix.
   * @private
   */
  async _resolveCollision(targetPath, dryRun) {
    if (dryRun) {
      const existing = await this.vault.readNote(targetPath);
      if (existing) {
        const parsed = path.parse(targetPath);
        return path.join(parsed.dir, `${parsed.name}-1${parsed.ext}`);
      }
      return targetPath;
    }

    let finalPath = targetPath;
    let counter   = 1;

    while (await this.vault.readNote(finalPath)) {
      const parsed = path.parse(targetPath);
      finalPath    = path.join(parsed.dir, `${parsed.name}-${counter}${parsed.ext}`);
      counter++;
      if (counter > 100) throw new Error(`Too many collisions for ${targetPath}`);
    }

    return finalPath;
  }

  // ─── Static helpers ───────────────────────────────────────────────────────

  /**
   * Parse a confidence string or number to a numeric value 0–1.
   * @param {string|number} confidence
   * @returns {number}
   */
  static _parseConfidence(confidence) {
    if (typeof confidence === 'number') return confidence;
    const level = (confidence || '').toLowerCase();
    if (level === 'high')   return 0.9;
    if (level === 'medium') return 0.6;
    if (level === 'low')    return 0.3;
    const parsed = parseFloat(confidence);
    return isNaN(parsed) ? 0.5 : parsed;
  }

  /**
   * Generate a unique session ID.
   * @returns {string}
   */
  static _generateSessionId() {
    return `filer-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  }
}

module.exports = Filer;
module.exports.parseConfidence    = Filer._parseConfidence;
module.exports.generateSessionId  = Filer._generateSessionId;
