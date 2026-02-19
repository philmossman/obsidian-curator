'use strict';

/**
 * VaultClient — CouchDB/LiveSync CRUD operations for Obsidian vaults.
 *
 * The vault stores notes using the LiveSync chunked format:
 *   - Each note has a metadata document (keyed by note path) with a `children`
 *     array pointing to content chunk documents.
 *   - Chunk documents are content-addressed (h:<sha256-prefix>) and shared.
 *   - Deletion is a soft-delete: sets `deleted: true`, clears `children`.
 */

const nano = require('nano');
const crypto = require('crypto');

// ─────────────────────────────────────────────
// Unicode sanitization
// ─────────────────────────────────────────────

/**
 * Sanitize text before writing to vault.
 *
 * Strips dangerous control characters (null bytes, \x00-\x08, \x0e-\x1f)
 * while preserving normal whitespace (tab, newline, carriage return) and
 * all Unicode/emoji characters.
 *
 * @param {string} text
 * @returns {string}
 */
function sanitizeUnicode(text) {
  if (typeof text !== 'string') return String(text || '');
  return text.replace(/[\x00-\x08\x0e-\x1f]/g, '');
}

// ─────────────────────────────────────────────
// Error helpers
// ─────────────────────────────────────────────

/**
 * Convert a raw CouchDB/nano error into a human-friendly message.
 * @param {Error} err
 * @returns {string}
 */
function friendlyCouchError(err) {
  if (!err) return 'Unknown error';
  const msg = err.message || '';
  if (err.code === 'ECONNREFUSED' || msg.includes('ECONNREFUSED')) {
    return 'CouchDB is not reachable — is the server running? (ECONNREFUSED)';
  }
  if (err.code === 'ECONNRESET' || msg.includes('ECONNRESET')) {
    return 'CouchDB connection was reset — server may be restarting.';
  }
  if (err.statusCode === 401 || msg.includes('Unauthorized')) {
    return 'CouchDB authentication failed — check credentials in config';
  }
  if (err.statusCode === 404) {
    return 'CouchDB database not found — check "database" in config';
  }
  return `CouchDB error: ${msg}`;
}

// ─────────────────────────────────────────────
// VaultClient
// ─────────────────────────────────────────────

class VaultClient {
  /**
   * @param {Object} vaultConfig - vault connection config
   * @param {string} vaultConfig.host
   * @param {number} vaultConfig.port
   * @param {string} vaultConfig.database
   * @param {string} [vaultConfig.username]
   * @param {string} [vaultConfig.password]
   * @param {string} [vaultConfig.protocol='http']
   */
  constructor(vaultConfig) {
    const {
      host,
      port,
      database,
      username = '',
      password = '',
      protocol = 'http'
    } = vaultConfig;

    const auth = username ? `${username}:${password}@` : '';
    const couchUrl = `${protocol}://${auth}${host}:${port}`;
    this.nano = nano(couchUrl);
    this.db = this.nano.db.use(database);
  }

  // ───────────────────────────────────────────
  // Connectivity
  // ───────────────────────────────────────────

  /**
   * Check CouchDB connectivity.
   * Returns { ok: true } if reachable, throws with a friendly message if not.
   * @returns {Promise<{ok: boolean}>}
   */
  async ping() {
    try {
      await this.nano.db.get(this.db.config.db);
      return { ok: true };
    } catch (err) {
      if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.statusCode === undefined) {
        throw new Error('CouchDB unavailable — is the server running? (ECONNREFUSED)');
      }
      if (err.statusCode === 401) {
        throw new Error('CouchDB authentication failed — check credentials in config');
      }
      if (err.statusCode === 404) {
        throw new Error('CouchDB database not found — check "database" in config');
      }
      throw new Error(`CouchDB error: ${err.message}`);
    }
  }

  // ───────────────────────────────────────────
  // CRUD
  // ───────────────────────────────────────────

  /**
   * List all notes (excluding chunks and system/deleted docs).
   * @returns {Promise<Array<{path: string, id: string, mtime: number, size: number}>>}
   */
  async listNotes() {
    try {
      const result = await this.db.list({ include_docs: true });
      return result.rows
        .filter(row => !row.id.startsWith('h:') && !row.id.startsWith('_'))
        .filter(row => row.id !== 'obsydian_livesync_version')
        .filter(row => !row.doc.deleted)
        .map(row => ({
          path: row.doc.path,
          id: row.id,
          mtime: row.doc.mtime,
          size: row.doc.size
        }));
    } catch (err) {
      if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') {
        throw new Error(friendlyCouchError(err));
      }
      throw err;
    }
  }

  /**
   * Read a note by path.
   * @param {string} path - Note path (e.g. "inbox/my-note.md")
   * @returns {Promise<{path: string, content: string, ctime: number, mtime: number, metadata: Object}|null>}
   */
  async readNote(path) {
    try {
      const docId = this._pathToId(path);
      const metadata = await this.db.get(docId);

      if (metadata.e_) {
        throw new Error('Note is encrypted — E2EE must be disabled for obsidian-curator to read it');
      }

      const chunks = await Promise.all(
        (metadata.children || []).map(chunkId => this.db.get(chunkId))
      );

      const content = chunks.map(chunk => chunk.data || '').join('');

      return {
        path: metadata.path,
        content,
        ctime: metadata.ctime,
        mtime: metadata.mtime,
        metadata
      };
    } catch (err) {
      if (err.statusCode === 404) return null;
      if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') {
        throw new Error(friendlyCouchError(err));
      }
      throw err;
    }
  }

  /**
   * Write or update a note. Content is sanitized before writing.
   * @param {string} path - Note path
   * @param {string} content - Note content (unicode is preserved; dangerous control chars stripped)
   * @param {Object} [options]
   * @param {string} [options.type='plain']
   * @returns {Promise<{ok: boolean, id: string, rev: string}>}
   */
  async writeNote(path, content, options = {}) {
    const safeContent = sanitizeUnicode(content);
    const docId = this._pathToId(path);
    const now = Date.now();

    let existingDoc = null;
    try {
      existingDoc = await this.db.get(docId);
    } catch (err) {
      if (err.statusCode !== 404) throw err;
    }

    const chunks = this._createChunks(safeContent);
    const chunkIds = [];

    for (const chunkData of chunks) {
      const chunkId = this._createChunkId(chunkData);
      chunkIds.push(chunkId);
      try {
        await this.db.get(chunkId);
      } catch (err) {
        if (err.statusCode === 404) {
          await this.db.insert({ _id: chunkId, type: 'leaf', data: chunkData });
        }
      }
    }

    const metadata = {
      _id: docId,
      ...(existingDoc && { _rev: existingDoc._rev }),
      children: chunkIds,
      path,
      ctime: existingDoc ? existingDoc.ctime : now,
      mtime: now,
      size: Buffer.byteLength(safeContent, 'utf8'),
      type: options.type || 'plain',
      eden: {}
    };

    const result = await this.db.insert(metadata);
    return { ok: true, id: result.id, rev: result.rev };
  }

  /**
   * Soft-delete a note (LiveSync-compatible).
   * Sets `deleted: true` and clears content; does NOT use db.destroy().
   * @param {string} path - Note path
   * @returns {Promise<{ok: boolean}>}
   */
  async deleteNote(path) {
    const docId = this._pathToId(path);
    const doc = await this.db.get(docId);

    doc.deleted = true;
    doc.data = '';
    doc.children = [];
    doc.mtime = Date.now();

    await this.db.insert(doc);
    return { ok: true };
  }

  /**
   * Move (rename) a note.
   * Writes the content to the new path, then soft-deletes the original.
   * @param {string} from - Source path
   * @param {string} to - Destination path
   * @returns {Promise<{ok: boolean}>}
   */
  async moveNote(from, to) {
    const note = await this.readNote(from);
    if (!note) throw new Error(`Note not found: ${from}`);
    await this.writeNote(to, note.content);
    await this.deleteNote(from);
    return { ok: true };
  }

  /**
   * Basic full-text search across all note paths (and optionally content).
   * This is a lightweight client-side filter over listNotes — for large vaults
   * a CouchDB view or Mango query would be more efficient.
   * @param {string} query - Case-insensitive search string
   * @returns {Promise<Array<{path: string, id: string, mtime: number, size: number}>>}
   */
  async searchNotes(query) {
    const notes = await this.listNotes();
    const lower = query.toLowerCase();
    return notes.filter(note => note.path && note.path.toLowerCase().includes(lower));
  }

  // ───────────────────────────────────────────
  // Frontmatter parsing
  // ───────────────────────────────────────────

  /**
   * Parse YAML frontmatter from note content.
   * Handles nested objects and inline arrays.
   * @param {string} content - Full note content
   * @returns {{frontmatter: Object, body: string}}
   */
  parseFrontmatter(content) {
    const lines = content.split('\n');

    if (lines[0] !== '---') {
      return { frontmatter: {}, body: content };
    }

    let endIndex = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].match(/^(---\s*)$/)) {
        endIndex = i;
        break;
      }
    }

    if (endIndex === -1) {
      return { frontmatter: {}, body: content };
    }

    const yamlLines = lines.slice(1, endIndex);
    const frontmatter = this._parseYamlBlock(yamlLines, 0).result;
    const body = lines.slice(endIndex + 1).join('\n');

    return { frontmatter, body };
  }

  /**
   * Build complete note content from frontmatter object and body string.
   * @param {Object} frontmatter - Key/value pairs for YAML block
   * @param {string} body - Note body (markdown)
   * @returns {string}
   */
  buildNote(frontmatter, body) {
    if (!frontmatter || Object.keys(frontmatter).length === 0) {
      return body;
    }

    const yamlLines = ['---'];
    for (const [key, value] of Object.entries(frontmatter)) {
      this._addYamlField(yamlLines, key, value, 0);
    }
    yamlLines.push('---');

    return yamlLines.join('\n') + '\n' + body;
  }

  // ───────────────────────────────────────────
  // Private helpers
  // ───────────────────────────────────────────

  /** @private */
  _pathToId(path) {
    let id = path.toLowerCase();
    if (id.startsWith('_')) id = '/' + id;
    return id;
  }

  /** @private */
  _createChunks(content, chunkSize = 50000) {
    const chunks = [];
    for (let i = 0; i < content.length; i += chunkSize) {
      chunks.push(content.slice(i, i + chunkSize));
    }
    return chunks.length > 0 ? chunks : [''];
  }

  /** @private */
  _createChunkId(data) {
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    return `h:${hash.substring(0, 12)}`;
  }

  /** @private */
  _parseYamlBlock(lines, startIndex, baseIndent = 0) {
    const result = {};
    let i = startIndex;

    while (i < lines.length) {
      const line = lines[i];
      const indent = this._getIndentLevel(line);

      if (indent < baseIndent && line.trim() !== '') break;

      if (line.trim() === '' || line.trim().startsWith('#')) {
        i++;
        continue;
      }

      const match = line.match(/^(\s*)([\w_-]+):\s*(.*)$/);
      if (!match) { i++; continue; }

      const [, , key, value] = match;
      const currentIndent = this._getIndentLevel(line);
      const nextLine = lines[i + 1];
      const nextIndent = nextLine ? this._getIndentLevel(nextLine) : -1;

      if (value === '' && nextIndent > currentIndent) {
        // Check if the next non-empty line is a block-sequence item (- ...)
        const nextTrimmed = nextLine ? nextLine.trim() : '';
        if (nextTrimmed.startsWith('- ') || nextTrimmed === '-') {
          // Parse as block-style array
          const arr = [];
          i++;
          while (i < lines.length) {
            const arrLine = lines[i];
            const arrIndent = this._getIndentLevel(arrLine);
            const arrTrimmed = arrLine.trim();
            if (arrTrimmed === '' || arrTrimmed.startsWith('#')) { i++; continue; }
            if (arrIndent < nextIndent) break;
            const arrMatch = arrTrimmed.match(/^-\s*(.*)$/);
            if (arrMatch) {
              arr.push(this._parseYamlValue(arrMatch[1]));
              i++;
            } else {
              break;
            }
          }
          result[key] = arr;
        } else {
          const nested = this._parseYamlBlock(lines, i + 1, nextIndent);
          result[key] = nested.result;
          i = nested.index;
        }
      } else {
        result[key] = this._parseYamlValue(value);
        i++;
      }
    }

    return { result, index: i };
  }

  /** @private */
  _getIndentLevel(line) {
    const match = line.match(/^(\s*)/);
    return match ? match[1].length : 0;
  }

  /** @private */
  _parseYamlValue(value) {
    value = value.trim();
    if (value === '') return '';
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null') return null;
    if (value.match(/^-?\d+$/)) return parseInt(value, 10);
    if (value.match(/^-?\d+\.\d+$/)) return parseFloat(value);

    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1);
      if (inner.trim() === '') return [];
      return inner.split(',').map(item => {
        item = item.trim();
        if ((item.startsWith('"') && item.endsWith('"'))
            || (item.startsWith("'") && item.endsWith("'"))) {
          return item.slice(1, -1);
        }
        return item;
      });
    }

    if ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }

    return value;
  }

  /** @private */
  _addYamlField(lines, key, value, indent) {
    const pad = '  '.repeat(indent);
    if (Array.isArray(value)) {
      lines.push(`${pad}${key}:`);
      value.forEach(item => lines.push(`${pad}  - ${item}`));
    } else if (typeof value === 'object' && value !== null) {
      lines.push(`${pad}${key}:`);
      for (const [k, v] of Object.entries(value)) {
        this._addYamlField(lines, k, v, indent + 1);
      }
    } else {
      lines.push(`${pad}${key}: ${value}`);
    }
  }
}

module.exports = VaultClient;
module.exports.VaultClient = VaultClient;
module.exports.sanitizeUnicode = sanitizeUnicode;
module.exports.friendlyCouchError = friendlyCouchError;
