/**
 * Undo - Reverse filing operations
 * Tracks all file operations and allows undoing entire sessions
 */

const fs = require('fs').promises;
const path = require('path');
const VaultClient = require('./vault-client');
const loadConfig = require('./config');

const HISTORY_PATH = path.join(__dirname, 'filing-history.json');

/**
 * Track a file operation for undo capability
 * @param {string} sessionId - Session ID
 * @param {Object} operation - Operation details
 * @returns {Promise<void>}
 */
async function trackOperation(sessionId, operation) {
  const history = await loadHistory();
  
  if (!history.sessions) {
    history.sessions = {};
  }
  
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
 * Undo last filing session
 * @param {string} sessionId - Session ID to undo
 * @returns {Promise<Object>} Undo results
 */
async function undoLastFiling(sessionId) {
  const config = loadConfig();
  const vaultClient = new VaultClient(config.couchdb);
  const history = await loadHistory();
  
  if (!history.sessions || !history.sessions[sessionId]) {
    throw new Error(`Session ${sessionId} not found`);
  }
  
  const session = history.sessions[sessionId];
  const operations = [...session.operations].reverse(); // Undo in reverse order
  
  const results = {
    sessionId,
    undone: 0,
    failed: 0,
    details: []
  };
  
  for (const op of operations) {
    try {
      await undoOperation(vaultClient, op);
      results.undone++;
      results.details.push({
        action: op.action,
        path: op.originalPath,
        status: 'undone'
      });
    } catch (err) {
      results.failed++;
      results.details.push({
        action: op.action,
        path: op.originalPath,
        status: 'failed',
        error: err.message
      });
    }
  }
  
  // Mark session as undone
  session.undone = true;
  session.undoneAt = Date.now();
  await saveHistory(history);
  
  return results;
}

/**
 * Undo a single operation
 * @param {VaultClient} vaultClient - Vault client instance
 * @param {Object} operation - Operation to undo
 * @returns {Promise<void>}
 */
async function undoOperation(vaultClient, operation) {
  // Guard: content is pruned after 7 days
  if (operation._contentExpired) {
    throw new Error(`Cannot undo — note content expired (>7 days old). Original path was: ${operation.originalPath}`);
  }

  if (operation.action === 'file' || operation.action === 'queue') {
    // Restore original note
    await vaultClient.writeNote(operation.originalPath, operation.originalContent);
    
    // Delete target note
    try {
      await vaultClient.deleteNote(operation.targetPath);
    } catch (err) {
      // Target might already be deleted, that's ok
      if (!err.message.includes('404')) {
        throw err;
      }
    }

  } else if (operation.action === 'tidy-delete') {
    // Restore a note that was deleted by /tidy
    if (operation.originalContent) {
      await vaultClient.writeNote(operation.originalPath, operation.originalContent);
    }

  } else if (operation.action === 'tidy-move') {
    // Reverse a /tidy move: restore to original path, delete from target
    await vaultClient.writeNote(operation.originalPath, operation.originalContent);
    try {
      await vaultClient.deleteNote(operation.targetPath);
    } catch (err) {
      if (!err.message.includes('404')) {
        throw err;
      }
    }

  } else {
    throw new Error(`Unknown operation type: ${operation.action}`);
  }
}

/**
 * Get list of recent sessions that can be undone
 * @param {number} limit - Max sessions to return (default: 10)
 * @returns {Promise<Array>} Recent sessions
 */
async function getRecentSessions(limit = 10) {
  const history = await loadHistory();
  
  if (!history.sessions) {
    return [];
  }
  
  const sessions = Object.entries(history.sessions)
    .filter(([_, session]) => !session.undone) // Only non-undone sessions
    .sort((a, b) => b[1].startTime - a[1].startTime) // Most recent first
    .slice(0, limit)
    .map(([sessionId, session]) => ({
      sessionId,
      startTime: session.startTime,
      operationCount: session.operations.length,
      actions: session.operations.map(op => op.action)
    }));
  
  return sessions;
}

/**
 * Get session details
 * @param {string} sessionId - Session ID
 * @returns {Promise<Object|null>} Session details or null if not found
 */
async function getSession(sessionId) {
  const history = await loadHistory();
  
  if (!history.sessions || !history.sessions[sessionId]) {
    return null;
  }
  
  return {
    sessionId,
    ...history.sessions[sessionId]
  };
}

/**
 * Load filing history from disk
 * @returns {Promise<Object>} History data
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
 * Applies two pruning rules to keep the file manageable:
 *   1. Keep at most 100 sessions (drop oldest beyond that)
 *   2. Strip note content (originalContent / newContent) from sessions
 *      older than 7 days — metadata is retained for auditing, content
 *      is only needed for the actual undo operation.
 * @param {Object} history - History data
 * @returns {Promise<void>}
 */
async function saveHistory(history) {
  if (!history.sessions) {
    history.sessions = {};
  }

  const now = Date.now();
  const CONTENT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  // Prune content from sessions older than 7 days
  for (const session of Object.values(history.sessions)) {
    const age = now - (session.startTime || 0);
    if (age > CONTENT_TTL_MS && session.operations) {
      session.operations = session.operations.map(op => {
        const { originalContent, newContent, ...rest } = op;
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

  const json = JSON.stringify(history, null, 2);
  await fs.writeFile(HISTORY_PATH, json, 'utf8');
}

/**
 * Clear all history (destructive, use with caution)
 * @returns {Promise<void>}
 */
async function clearHistory() {
  await fs.writeFile(HISTORY_PATH, JSON.stringify({ sessions: {}, version: 1 }, null, 2), 'utf8');
}

module.exports = {
  trackOperation,
  undoLastFiling,
  getRecentSessions,
  getSession,
  loadHistory,
  saveHistory,
  clearHistory
};
