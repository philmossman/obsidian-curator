'use strict';

/**
 * Undo — session-based undo for file and tidy operations.
 *
 * Operations are persisted to ~/.obsidian-curator/filing-history.json.
 * Content is retained for 7 days for undo, then pruned (metadata kept).
 * At most 100 sessions are retained at any time.
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const HISTORY_DIR  = path.join(os.homedir(), '.obsidian-curator');
const HISTORY_PATH = path.join(HISTORY_DIR, 'filing-history.json');

// ─────────────────────────────────────────────
// History I/O
// ─────────────────────────────────────────────

/**
 * Load filing history from disk.
 * @returns {Promise<Object>}
 */
async function loadHistory() {
  try {
    const raw = await fs.readFile(HISTORY_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { sessions: {}, version: 1 };
    }
    throw err;
  }
}

/**
 * Save filing history to disk.
 *
 * Pruning rules:
 *   - Strip note content from sessions older than 7 days
 *   - Keep at most 100 sessions (oldest dropped first)
 *
 * @param {Object} history
 * @returns {Promise<void>}
 */
async function saveHistory(history) {
  if (!history.sessions) history.sessions = {};

  const now = Date.now();
  const CONTENT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  // Prune content from old sessions
  for (const session of Object.values(history.sessions)) {
    const age = now - (session.startTime || 0);
    if (age > CONTENT_TTL_MS && session.operations) {
      session.operations = session.operations.map(op => {
        const { originalContent, newContent, ...rest } = op; // eslint-disable-line no-unused-vars
        return { ...rest, _contentExpired: true };
      });
    }
  }

  // Keep at most 100 sessions (drop oldest)
  if (Object.keys(history.sessions).length > 100) {
    const sorted = Object.entries(history.sessions)
      .sort((a, b) => b[1].startTime - a[1].startTime);
    history.sessions = Object.fromEntries(sorted.slice(0, 100));
  }

  // Ensure directory exists
  try {
    await fs.mkdir(HISTORY_DIR, { recursive: true });
  } catch (_) { /* already exists */ }

  await fs.writeFile(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf8');
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Track a file/tidy operation for undo capability.
 *
 * @param {string} sessionId - Session identifier
 * @param {Object} operation - Operation details
 * @param {string} operation.action         - 'file' | 'queue' | 'tidy-delete' | 'tidy-move'
 * @param {string} operation.originalPath   - Note path before operation
 * @param {string|null} operation.targetPath - Note path after operation (null for deletes)
 * @param {number} operation.timestamp      - Unix ms timestamp
 * @param {string} operation.originalContent - Note content before operation
 * @param {string} [operation.newContent]   - Note content after operation
 * @returns {Promise<void>}
 */
async function trackOperation(sessionId, operation) {
  const history = await loadHistory();

  if (!history.sessions) history.sessions = {};

  if (!history.sessions[sessionId]) {
    history.sessions[sessionId] = {
      startTime: Date.now(),
      operations: []
    };
  }

  history.sessions[sessionId].operations.push(operation);
  await saveHistory(history);
}

/**
 * Undo all operations from a session, in reverse order.
 *
 * @param {string}  sessionId - Session to undo
 * @param {Object}  vault     - VaultClient instance
 * @returns {Promise<Object>} { sessionId, undone, failed, details }
 */
async function undoSession(sessionId, vault) {
  const history = await loadHistory();

  if (!history.sessions || !history.sessions[sessionId]) {
    throw new Error(`Session "${sessionId}" not found in undo history`);
  }

  const session = history.sessions[sessionId];
  const operations = [...session.operations].reverse(); // undo newest-first

  const results = {
    sessionId,
    undone: 0,
    failed: 0,
    details: []
  };

  for (const op of operations) {
    try {
      await undoOperation(vault, op);
      results.undone++;
      results.details.push({ action: op.action, path: op.originalPath, status: 'undone' });
    } catch (err) {
      results.failed++;
      results.details.push({ action: op.action, path: op.originalPath, status: 'failed', error: err.message });
    }
  }

  // Mark session as undone
  session.undone    = true;
  session.undoneAt  = Date.now();
  await saveHistory(history);

  return results;
}

/**
 * Reverse a single operation.
 * @param {Object} vault  - VaultClient instance
 * @param {Object} op     - Operation record
 * @returns {Promise<void>}
 */
async function undoOperation(vault, op) {
  if (op._contentExpired) {
    throw new Error(
      `Cannot undo — note content expired (>7 days old). Original path was: ${op.originalPath}`
    );
  }

  if (op.action === 'file' || op.action === 'queue') {
    await vault.writeNote(op.originalPath, op.originalContent);
    try {
      await vault.deleteNote(op.targetPath);
    } catch (err) {
      if (!(err.message || '').includes('404')) throw err;
    }

  } else if (op.action === 'tidy-delete') {
    if (op.originalContent) {
      await vault.writeNote(op.originalPath, op.originalContent);
    }

  } else if (op.action === 'tidy-move') {
    await vault.writeNote(op.originalPath, op.originalContent);
    try {
      await vault.deleteNote(op.targetPath);
    } catch (err) {
      if (!(err.message || '').includes('404')) throw err;
    }

  } else {
    throw new Error(`Unknown operation type: "${op.action}"`);
  }
}

/**
 * List recent undo sessions (most recent first, not-yet-undone).
 * @param {number} [limit=10]
 * @returns {Promise<Array>}
 */
async function getRecentSessions(limit = 10) {
  const history = await loadHistory();
  if (!history.sessions) return [];

  return Object.entries(history.sessions)
    .filter(([, session]) => !session.undone)
    .sort((a, b) => b[1].startTime - a[1].startTime)
    .slice(0, limit)
    .map(([sessionId, session]) => ({
      sessionId,
      startTime:      session.startTime,
      operationCount: session.operations.length,
      actions:        session.operations.map(op => op.action)
    }));
}

/**
 * Get a session's details.
 * @param {string} sessionId
 * @returns {Promise<Object|null>}
 */
async function getSession(sessionId) {
  const history = await loadHistory();
  if (!history.sessions || !history.sessions[sessionId]) return null;
  return { sessionId, ...history.sessions[sessionId] };
}

/**
 * Clear all history (destructive).
 * @returns {Promise<void>}
 */
async function clearHistory() {
  try { await fs.mkdir(HISTORY_DIR, { recursive: true }); } catch (_) {}
  await fs.writeFile(
    HISTORY_PATH,
    JSON.stringify({ sessions: {}, version: 1 }, null, 2),
    'utf8'
  );
}

module.exports = {
  trackOperation,
  undoSession,
  undoOperation,
  getRecentSessions,
  getSession,
  loadHistory,
  saveHistory,
  clearHistory,
  HISTORY_PATH
};
