/**
 * Tidy Executor - Applies housekeeping decisions to the vault
 * Phase 4.3: /tidy command
 *
 * Decision pipeline:
 *   1. Rule-based, confidence >= 0.8 → auto-fix immediately
 *   2. Rule-based, confidence < 0.8  → AI triage → act if AI confidence >= 0.6
 *   3. AI unsure (confidence < 0.6 or action=flag) → flag for Phil
 *
 * All actions are logged to an undo session.
 */

const VaultClient = require('./vault-client');
const loadConfig = require('./config');
const { trackOperation } = require('./undo');
const { scanVault } = require('./tidy-scanner');
const { triageIssues, AI_ACT_THRESHOLD } = require('./tidy-ai');
const crypto = require('crypto');

/** Notes with rule confidence >= this are auto-fixed without AI involvement. */
const HIGH_CONFIDENCE_THRESHOLD = 0.8;

// ────────────────────────────────────────────────────────────────────────────
// Main entry point
// ────────────────────────────────────────────────────────────────────────────

/**
 * Run the full tidy pipeline.
 *
 * @param {Object} options
 * @param {string[]} options.checks   - ['dupes','structure','stubs'] or ['all']
 * @param {boolean}  options.dryRun   - Preview only, make no changes
 * @param {string}   options.sessionId - Undo session ID (auto-generated if omitted)
 * @returns {Promise<Object>} Results: { sessionId, dryRun, totalNotes, totalIssues,
 *                                       autoFixed, aiFixed, flagged, failed }
 */
async function runTidy(options = {}) {
  const config = loadConfig();
  const vault = new VaultClient(config.couchdb);

  const dryRun = options.dryRun || false;
  const sessionId = options.sessionId || generateSessionId();
  const checks = options.checks || ['all'];

  // ── Phase 1: Scan ──────────────────────────────────────────────────────────
  console.log('[tidy] Scanning vault for issues...');
  const { notes, issues, canonicalFolders } = await scanVault({ checks });
  console.log(`[tidy] ${notes.length} notes scanned, ${issues.length} issues found`);

  // Partition by confidence
  const highConfidence = issues.filter(i => i.confidence >= HIGH_CONFIDENCE_THRESHOLD);
  const lowConfidence  = issues.filter(i => i.confidence <  HIGH_CONFIDENCE_THRESHOLD);
  console.log(`[tidy] Auto-fix: ${highConfidence.length}  AI triage: ${lowConfidence.length}`);

  // ── Phase 2: AI triage for ambiguous issues ────────────────────────────────
  let aiTriaged = [];
  if (lowConfidence.length > 0) {
    console.log(`[tidy] Running AI triage on ${lowConfidence.length} low-confidence issues...`);
    aiTriaged = await triageIssues(lowConfidence);
  }

  // ── Phase 3: Execute decisions ─────────────────────────────────────────────
  const results = {
    sessionId,
    dryRun,
    totalNotes:  notes.length,
    totalIssues: issues.length,
    autoFixed:   [],  // high-confidence rule hits
    aiFixed:     [],  // AI-resolved
    flagged:     [],  // unresolved / AI unsure
    failed:      []   // errors during execution
  };

  // Execute high-confidence auto-fixes
  for (const issue of highConfidence) {
    try {
      const result = await executeDecision(
        vault, issue,
        issue.suggestedAction,
        issue.targetPath || null,
        { dryRun, sessionId, source: 'rule' }
      );

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
        aiAction: decision ? decision.action : null,
        source: 'ai'
      });
      continue;
    }

    // AI said keep → no action needed, just record
    if (decision.action === 'keep') {
      results.aiFixed.push({
        type: issue.type,
        path: issue.path,
        action: 'keep',
        reason: issue.reason,
        aiReasoning: decision.reasoning,
        confidence: decision.confidence,
        dryRun,
        done: false,
        source: 'ai'
      });
      continue;
    }

    try {
      const result = await executeDecision(
        vault, issue,
        decision.action,
        decision.targetPath || null,
        { dryRun, sessionId, aiDecision: decision, source: 'ai' }
      );

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

// ────────────────────────────────────────────────────────────────────────────
// Decision execution
// ────────────────────────────────────────────────────────────────────────────

/**
 * Execute a single housekeeping decision on a note.
 *
 * @param {VaultClient} vault
 * @param {Object}  issue       - The original issue
 * @param {string}  action      - 'delete' | 'move' | 'keep' | 'merge' | 'flag'
 * @param {string|null} targetPath - Required for 'move'
 * @param {Object}  options     - { dryRun, sessionId, aiDecision, source }
 * @returns {Promise<Object>}   Result record
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
    aiReasoning: aiDecision ? aiDecision.reasoning : undefined,
    dryRun,
    source
  };

  // ── delete ──────────────────────────────────────────────────────────────────
  if (action === 'delete') {
    if (!dryRun) {
      // Save content before deleting (needed for undo)
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
      result.action = 'flag';
      result.flagReason = 'Move action requires a targetPath';
      result.done = false;
      return result;
    }

    if (!dryRun) {
      const noteData = await vault.readNote(issue.path);
      if (!noteData) {
        throw new Error(`Note not found at ${issue.path}`);
      }

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
    result.done = false; // No action taken

  // ── merge ──────────────────────────────────────────────────────────────────
  } else if (action === 'merge') {
    // Merging requires human judgement — always flag
    result.action = 'flag';
    result.flagReason = 'Merge requires manual review (automated merge not implemented)';
    result.done = false;

  // ── unknown ────────────────────────────────────────────────────────────────
  } else {
    result.action = 'flag';
    result.flagReason = `Unknown action: "${action}"`;
    result.done = false;
  }

  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Generate a tidy session ID for undo tracking.
 * Format: tidy-YYYYMMDD-xxxxxx
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
