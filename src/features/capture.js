'use strict';

/**
 * Capture feature — quick capture of raw text to the inbox.
 *
 * No AI required. Adds timestamp frontmatter and stores the note
 * in the configured inbox folder.
 */

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Slugify the first few words of a string for use in filenames.
 * @param {string} text
 * @param {number} [maxWords=6]
 * @returns {string}
 */
function slugify(text, maxWords = 6) {
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
 * Format a Date as a compact timestamp string: YYYYMMDD-HHmmss
 * @param {Date} date
 * @returns {string}
 */
function isoStamp(date) {
  const pad = n => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Capture raw text to the inbox with timestamp frontmatter.
 *
 * @param {Object} vault  - VaultClient instance
 * @param {Object} config - Loaded curator config
 * @param {string} text   - Content to capture
 * @param {Object} [options]
 * @param {string} [options.source='cli'] - Source tag for frontmatter
 * @returns {Promise<string>} Path of the created note
 */
async function capture(vault, config, text, options = {}) {
  if (!text || !text.trim()) {
    throw new Error('capture() requires non-empty text');
  }

  const source      = options.source || 'cli';
  const now         = new Date();
  const slug        = slugify(text);
  const ts          = isoStamp(now);
  const inboxFolder = (config.structure && config.structure.folders && config.structure.folders.inbox) || 'inbox';
  const notePath    = `${inboxFolder}/${slug}-${ts}.md`;

  const frontmatter = {
    created: now.toISOString(),
    source,
    tags: []
  };

  const content = vault.buildNote(frontmatter, text);
  await vault.writeNote(notePath, content);

  return notePath;
}

module.exports = { capture, slugify, isoStamp };
