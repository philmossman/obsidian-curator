const VaultClient = require('./vault-client');
const loadConfig = require('./config');
const config = loadConfig();
const vaultClient = new VaultClient(config.couchdb);

// Unicode sanitization is handled by VaultClient.writeNote() internally.
// All content written to the vault is sanitized at that layer.
// Do not duplicate sanitization here — import from vault-client if needed.
const { sanitizeUnicode } = require('./vault-client');

/**
 * Capture a note to the inbox with YAML frontmatter
 * @param {string} text - The note content
 * @param {object} metadata - Metadata object (should include 'source')
 * @returns {Promise<string>} - The created note path
 */
async function captureNote(text, metadata = {}) {
  const now = new Date();
  
  // Format timestamp: YYYY-MM-DD-HHMMSS
  const timestamp = now.toISOString()
    .replace(/T/, '-')
    .replace(/:/g, '')
    .slice(0, 17); // YYYY-MM-DD-HHMMSS
  
  // Extract first few words for filename (max 5 words, 30 chars)
  const firstWords = text
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join('-')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .slice(0, 30)
    .toLowerCase();
  
  // Build filename
  const filename = `inbox/${timestamp}-${firstWords}.md`;
  
  // Sanitize text to prevent LiveSync corruption from Unicode
  const safeText = sanitizeUnicode(text);
  
  // Create YAML frontmatter
  const frontmatter = [
    '---',
    `created: ${now.toISOString()}`,
    `source: ${metadata.source || 'unknown'}`,
    '---',
    '',
    safeText
  ].join('\n');
  
  // Create the note (content is already sanitized)
  await vaultClient.writeNote(filename, frontmatter);
  
  return filename;
}

module.exports = { captureNote, sanitizeUnicode };
