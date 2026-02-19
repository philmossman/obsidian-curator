'use strict';

/**
 * Tidy AI Triage — AI triage for low-confidence housekeeping issues.
 *
 * Uses the configured AI adapter (this.ai.complete()) to review ambiguous
 * notes and decide: delete / move / merge / keep / flag.
 *
 * Never makes direct API calls — all AI access goes through the adapter.
 */

const path = require('path');
const {
  buildDivergedDuplicatePrompt,
  buildStructureViolationPrompt,
  buildStubPrompt,
  buildGenericTriagePrompt
} = require('../prompts');

/** Minimum AI confidence to act on a decision (below this → flag). */
const AI_ACT_THRESHOLD = 0.6;

// ─────────────────────────────────────────────
// AiTriage class
// ─────────────────────────────────────────────

class AiTriage {
  /**
   * @param {Object} vault            - VaultClient instance
   * @param {Object} ai               - AIAdapter instance
   * @param {string[]} canonicalFolders - Canonical folder list from config
   */
  constructor(vault, ai, canonicalFolders) {
    if (!vault) throw new Error('AiTriage requires a vault (VaultClient instance)');
    if (!ai)    throw new Error('AiTriage requires an AI adapter');
    this.vault            = vault;
    this.ai               = ai;
    this.canonicalFolders = canonicalFolders || [];
  }

  /**
   * Triage a batch of low-confidence issues.
   *
   * @param {Array}  issues  - Issues to triage
   * @param {Object} [options]
   * @returns {Promise<Array>} Issues with `.aiDecision` added to each
   */
  async triageIssues(issues, options = {}) {
    const results = [];

    for (const issue of issues) {
      try {
        const decision = await this.triageIssue(issue, options);
        results.push({ ...issue, aiDecision: decision });
      } catch (err) {
        // AI failure → flag for manual review, never throw
        results.push({
          ...issue,
          aiDecision: {
            action:     'flag',
            reasoning:  `AI triage failed: ${err.message}`,
            targetPath: null,
            confidence: 0
          }
        });
      }
    }

    return results;
  }

  /**
   * Triage a single issue.
   *
   * @param {Object}  issue
   * @param {Object}  [options]
   * @returns {Promise<{ action, reasoning, targetPath, confidence }>}
   */
  async triageIssue(issue, options = {}) {
    const note = await this.vault.readNote(issue.path);
    if (!note) {
      return {
        action:     'delete',
        reasoning:  'Note no longer exists in vault',
        targetPath: null,
        confidence: 0.95
      };
    }

    const content = (note.content || '').trim();
    let prompt;

    if (issue.type === 'duplicate' && issue.subtype === 'diverged') {
      const relatedSnippets = [];
      for (const relPath of (issue.relatedPaths || []).slice(0, 2)) {
        try {
          const relNote = await this.vault.readNote(relPath);
          if (relNote) {
            relatedSnippets.push(
              `Path: ${relPath}\nContent (truncated):\n${(relNote.content || '').slice(0, 500)}`
            );
          }
        } catch (_) { /* skip */ }
      }
      prompt = buildDivergedDuplicatePrompt(issue, content, relatedSnippets, this.canonicalFolders);

    } else if (issue.type === 'structure') {
      prompt = buildStructureViolationPrompt(issue, content, this.canonicalFolders);

    } else if (issue.type === 'stub') {
      const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
      prompt = buildStubPrompt(issue, content, wordCount, this.canonicalFolders);

    } else {
      prompt = buildGenericTriagePrompt(issue, content, this.canonicalFolders);
    }

    const raw = await this.ai.complete(prompt, { temperature: 0.2 });
    return this._parseAIResponse(raw);
  }

  /**
   * Parse the raw AI response into a structured decision object.
   * Always returns a valid object — never throws.
   * @private
   */
  _parseAIResponse(raw) {
    try {
      const jsonMatch = (raw || '').match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { action: 'flag', reasoning: 'Could not parse AI response', targetPath: null, confidence: 0 };
      }

      const parsed      = JSON.parse(jsonMatch[0]);
      const validActions = ['delete', 'move', 'merge', 'keep', 'flag'];
      const action      = validActions.includes(parsed.action) ? parsed.action : 'flag';

      let targetPath = parsed.targetPath || null;
      if (action === 'move' && !targetPath) {
        return {
          action:     'flag',
          reasoning:  `AI suggested move but provided no target path. Original: ${parsed.reasoning || ''}`,
          targetPath: null,
          confidence: 0
        };
      }

      const confidence = typeof parsed.confidence === 'number'
        ? Math.min(1, Math.max(0, parsed.confidence))
        : 0.5;

      return {
        action,
        reasoning:  String(parsed.reasoning || '').slice(0, 300),
        targetPath,
        confidence
      };
    } catch (err) {
      return { action: 'flag', reasoning: `JSON parse error: ${err.message}`, targetPath: null, confidence: 0 };
    }
  }
}

module.exports = { AiTriage, AI_ACT_THRESHOLD };
