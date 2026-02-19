'use strict';

/**
 * Tidy Executor — applies housekeeping decisions to the vault.
 *
 * Decision pipeline:
 *   1. Rule-based, confidence ≥ HIGH_CONFIDENCE_THRESHOLD → auto-fix
 *   2. Rule-based, confidence < HIGH_CONFIDENCE_THRESHOLD → AI triage → act if AI confidence ≥ AI_ACT_THRESHOLD
 *   3. AI unsure (confidence < AI_ACT_THRESHOLD or action=flag) → flag for review
 *
 * All destructive actions are logged to an undo session.
 */

const crypto            = require('crypto');
const { scanVault }     = require('./scanner');
const { AiTriage, AI_ACT_THRESHOLD } = require('./ai-triage');
const { trackOperation } = require('../../core/undo');
const { getCanonicalFolders } = require('../../core/config');

/** Rule-based confidence threshold for automatic action (without AI). */
const HIGH_CONFIDENCE_THRESHOLD = 0.8;

// ─────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────

/**
 * Run the full tidy pipeline.
 *
 * @param {Object}   vault   - VaultClient instance
 * @param {Object}   ai      - AIAdapter instance (may be NoneAdapter)
 * @param {Object}   config  - Loaded curator config
 * @param {Object}   [options]
 * @param {string[]} [options.checks]    - ['dupes','structure','stubs'] or ['all']
 * @param {boolean}  [options.dryRun]   - Preview only
 * @param {string}   [options.sessionId] - Auto-generated if omitted
 * @returns {Promise<Object>} Results: { sessionId, dryRun, totalNotes, totalIssues,
 *                                       autoFixed, aiFixed, flagged, failed }
 */
async function runTidy(vault, ai, config, options = {}) {
  const dryRun    = options.dryRun    || false;
  const sessionId = options.sessionId || generateSessionId();
  const checks    = options.checks    || ['all'];

  const canonicalFolders = getCanonicalFolders(config);

  // ── Phase 1: Scan ──────────────────────────────────────────────────────────
  const { notes, issues } = await scanVault(vault, config, { checks });

  // Partition by confidence
  const highConfidence = issues.filter(i => i.confidence >= HIGH_CONFIDENCE_THRESHOLD);
  const lowConfidence  = issues.filter(i => i.confidence <  HIGH_CONFIDENCE_THRESHOLD);

  // ── Phase 2: AI triage for ambiguous issues ────────────────────────────────
  let aiTriaged = [];
  const hasAI   = ai && ai.constructor.name !== 'NoneAdapter';

  if (lowConfidence.length > 0 && hasAI) {
    const triage  = new AiTriage(vault, ai, canonicalFolders);
    aiTriaged     = await triage.triageIssues(lowConfidence);
  } else {
    // No AI → flag all low-confidence issues
    aiTriaged = lowConfidence.map(issue => ({
      ...issue,
      aiDecision: {
        action:     'flag',
        reasoning:  'No AI adapter configured — flagged for manual review',
        targetPath: null,
        confidence: 0
      }
    }));
  }

  // ── Phase 3: Execute decisions ─────────────────────────────────────────────
  const results = {
    sessionId,
    dryRun,
    totalNotes:  notes.length,
    totalIssues: issues.length,
    autoFixed:   [],
    aiFixed:     [],
    flagged:     [],
    failed:      []
  };

  // Execute high-confidence auto-fixes
  for (const issue of highConfidence) {
    try {
      const result = await executeDecision(vault, issue, issue.suggestedAction, null, {
        dryRun, sessionId, source: 'rule'
      });
      if (result.action === 'flag') {
        results.flagged.push({ ...result, source: 'rule' });
      } else {
        results.autoFixed.push({ ...result, source: 'rule' });
      }
    } catch (err) {
      results.failed.push({ ...issue, error: err.message });
    }
  }

  // Execute AI-triaged decisions
  for (const issue of aiTriaged) {
    const decision = issue.aiDecision;

    if (!decision || decision.action === 'flag' || decision.confidence < AI_ACT_THRESHOLD) {
      results.flagged.push({
        ...issue,
        flagReason: decision ? decision.reasoning : 'No AI decision returned',
        aiAction:   decision ? decision.action    : null,
        source:     'ai'
      });
      continue;
    }

    if (decision.action === 'keep') {
      results.aiFixed.push({
        type:        issue.type,
        path:        issue.path,
        action:      'keep',
        reason:      issue.reason,
        aiReasoning: decision.reasoning,
        confidence:  decision.confidence,
        dryRun,
        done:        false,
        source:      'ai'
      });
      continue;
    }

    try {
      const result = await executeDecision(vault, issue, decision.action, decision.targetPath || null, {
        dryRun, sessionId, aiDecision: decision, source: 'ai'
      });
      if (result.action === 'flag') {
        results.flagged.push({ ...result, source: 'ai', flagReason: result.flagReason || decision.reasoning });
      } else {
        results.aiFixed.push({ ...result, source: 'ai' });
      }
    } catch (err) {
      results.failed.push({ ...issue, error: err.message });
    }
  }

  return results;
}

// ─────────────────────────────────────────────
// Decision execution
// ─────────────────────────────────────────────

/**
 * Execute a single housekeeping decision.
 *
 * @param {Object}      vault
 * @param {Object}      issue
 * @param {string}      action      - 'delete' | 'move' | 'keep' | 'merge' | 'flag'
 * @param {string|null} targetPath  - Required for 'move'
 * @param {Object}      options     - { dryRun, sessionId, aiDecision, source }
 * @returns {Promise<Object>} Result record
 */
async function executeDecision(vault, issue, action, targetPath, options = {}) {
  const { dryRun = false, sessionId, aiDecision, source = 'rule' } = options;

  const result = {
    type:        issue.type,
    subtype:     issue.subtype,
    path:        issue.path,
    action,
    targetPath,
    reason:      issue.reason,
    confidence:  aiDecision ? aiDecision.confidence : issue.confidence,
    aiReasoning: aiDecision ? aiDecision.reasoning  : undefined,
    dryRun,
    source
  };

  // ── delete ──────────────────────────────────────────────────────────────────
  if (action === 'delete') {
    if (!dryRun) {
      let originalContent = '';
      try {
        const noteData = await vault.readNote(issue.path);
        originalContent = noteData ? (noteData.content || '') : '';
      } catch (_) { /* best effort */ }

      await vault.deleteNote(issue.path);

      await trackOperation(sessionId, {
        action:          'tidy-delete',
        originalPath:    issue.path,
        targetPath:      null,
        timestamp:       Date.now(),
        originalContent,
        newContent:      '',
        reason:          issue.reason
      });
    }
    result.done = !dryRun;

  // ── move ───────────────────────────────────────────────────────────────────
  } else if (action === 'move') {
    if (!targetPath) {
      result.action    = 'flag';
      result.flagReason = 'Move action requires a targetPath';
      result.done      = false;
      return result;
    }

    if (!dryRun) {
      const noteData = await vault.readNote(issue.path);
      if (!noteData) throw new Error(`Note not found at ${issue.path}`);

      await vault.writeNote(targetPath, noteData.content);
      await vault.deleteNote(issue.path);

      await trackOperation(sessionId, {
        action:          'tidy-move',
        originalPath:    issue.path,
        targetPath,
        timestamp:       Date.now(),
        originalContent: noteData.content,
        newContent:      noteData.content
      });
    }
    result.done = !dryRun;

  // ── keep ───────────────────────────────────────────────────────────────────
  } else if (action === 'keep') {
    result.done = false;

  // ── merge ──────────────────────────────────────────────────────────────────
  } else if (action === 'merge') {
    result.action    = 'flag';
    result.flagReason = 'Merge requires manual review (automated merge not implemented)';
    result.done      = false;

  // ── unknown ────────────────────────────────────────────────────────────────
  } else {
    result.action    = 'flag';
    result.flagReason = `Unknown action: "${action}"`;
    result.done      = false;
  }

  return result;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Generate a tidy session ID for undo tracking.
 * @returns {string}
 */
function generateSessionId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `tidy-${date}-${crypto.randomBytes(3).toString('hex')}`;
}

module.exports = {
  runTidy,
  executeDecision,
  generateSessionId,
  HIGH_CONFIDENCE_THRESHOLD
};
