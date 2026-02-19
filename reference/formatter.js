/**
 * Note Formatter - Core markdown formatting logic
 * Handles table formatting, heading normalization, list standardization, etc.
 */

const fs = require('fs').promises;
const path = require('path');
const VaultClient = require('./vault-client');

// Unicode sanitization is handled by VaultClient.writeNote() internally.
// All content written to the vault is sanitized at that layer.
// Import the canonical version here for any pre-write use.
const { sanitizeUnicode } = require('./vault-client');

/**
 * Parse YAML frontmatter from note content
 * @param {string} content - Note content with potential frontmatter
 * @returns {Object} - { frontmatter, body, hasFrontmatter }
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  
  if (match) {
    return {
      frontmatter: match[1],
      body: match[2],
      hasFrontmatter: true
    };
  }
  
  return {
    frontmatter: '',
    body: content,
    hasFrontmatter: false
  };
}

/**
 * Format markdown content
 * - Normalize headings (maintain hierarchy)
 * - Standardize list markers (all use -)
 * - Format tables (spacing, alignment)
 * - Add proper whitespace between sections
 * - Preserve all content
 * 
 * @param {string} content - Markdown content to format
 * @param {Object} options - Formatting options
 * @returns {Object} - { formatted, changed, details }
 */
function formatMarkdown(content, options = {}) {
  const {
    minHeadingLevel = 1,
    maxHeadingLevel = 6,
    normalizeHeadings = true,
    standardizeLists = true,
    formatTables = true,
    addWhitespace = true
  } = options;
  
  let formatted = content;
  const changes = [];
  
  // 1. Standardize list markers
  if (standardizeLists) {
    const listChanges = standardizeListMarkers(formatted);
    formatted = listChanges.content;
    if (listChanges.changed) {
      changes.push('Standardized list markers');
    }
  }
  
  // 2. Format tables (enhance readability)
  if (formatTables) {
    const tableChanges = enhanceTables(formatted);
    formatted = tableChanges.content;
    if (tableChanges.changed) {
      changes.push('Formatted tables');
    }
  }
  
  // 3. Normalize headings
  if (normalizeHeadings) {
    const headingChanges = normalizeHeadingLevels(formatted, minHeadingLevel, maxHeadingLevel);
    formatted = headingChanges.content;
    if (headingChanges.changed) {
      changes.push('Normalized heading levels');
    }
  }
  
  // 4. Add/normalize whitespace
  if (addWhitespace) {
    const whitespaceChanges = normalizeWhitespace(formatted);
    formatted = whitespaceChanges.content;
    if (whitespaceChanges.changed) {
      changes.push('Normalized whitespace');
    }
  }
  
  return {
    formatted,
    changed: changes.length > 0,
    details: changes
  };
}

/**
 * Standardize list markers (all use -)
 * @param {string} content - Content to process
 * @returns {Object} - { content, changed }
 */
function standardizeListMarkers(content) {
  let changed = false;
  
  // Replace * and + with - at beginning of lines (with 0-4 spaces indent)
  const updated = content.replace(/^([ ]{0,4})[\*\+](\s+)/gm, (match, indent, space) => {
    changed = true;
    return `${indent}-${space}`;
  });
  
  return { content: updated, changed };
}

/**
 * Enhance table formatting
 * - Ensures proper spacing around pipes
 * - Aligns columns for readability
 * @param {string} content - Content to process
 * @returns {Object} - { content, changed }
 */
function enhanceTables(content) {
  let changed = false;
  const lines = content.split('\n');
  const result = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Detect table separator line (e.g., | --- | --- |)
    if (line.match(/^\s*\|\s*[-:]+\s*\|\s*[-:]+/)) {
      // This is a table - format surrounding lines
      
      // Process table header (previous line)
      if (i > 0 && lines[i - 1].includes('|')) {
        const headerFormatted = formatTableRow(lines[i - 1]);
        result[result.length - 1] = headerFormatted;
        changed = true;
      }
      
      // Format separator line
      const sepFormatted = formatTableSeparator(line);
      result.push(sepFormatted);
      if (sepFormatted !== line) changed = true;
      
      // Process table body (following lines)
      let j = i + 1;
      while (j < lines.length && lines[j].includes('|')) {
        const cellFormatted = formatTableRow(lines[j]);
        result.push(cellFormatted);
        if (cellFormatted !== lines[j]) changed = true;
        j++;
      }
      
      i = j - 1; // Skip processed lines
    } else {
      result.push(line);
    }
  }
  
  return { content: result.join('\n'), changed };
}

/**
 * Format a table row with proper spacing
 * @param {string} row - Table row (e.g., "| col1 | col2 |")
 * @returns {string} - Formatted row
 */
function formatTableRow(row) {
  // Split by | and trim whitespace
  const cells = row.split('|').map(cell => cell.trim());
  
  // Remove empty first/last cells (from leading/trailing |)
  if (cells[0] === '') cells.shift();
  if (cells[cells.length - 1] === '') cells.pop();
  
  // Rejoin with consistent spacing
  return '| ' + cells.join(' | ') + ' |';
}

/**
 * Format table separator with consistent style
 * @param {string} sep - Separator line
 * @returns {string} - Formatted separator
 */
function formatTableSeparator(sep) {
  // Extract alignment indicators
  const cells = sep.split('|').map(cell => {
    const trimmed = cell.trim();
    // Check for alignment (: position)
    if (trimmed.match(/^:.*:$/)) return ':---:'; // Center
    if (trimmed.match(/^:.*$/)) return ':---'; // Left
    if (trimmed.match(/^.*:$/)) return '---:'; // Right
    return '---'; // Default
  }).filter(c => c !== '');
  
  return '| ' + cells.join(' | ') + ' |';
}

/**
 * Normalize heading levels in markdown
 * Ensures valid hierarchy (e.g., no # followed by ###)
 * @param {string} content - Content to process
 * @param {number} minLevel - Minimum heading level (default 1)
 * @param {number} maxLevel - Maximum heading level (default 6)
 * @returns {Object} - { content, changed }
 */
function normalizeHeadingLevels(content, minLevel = 1, maxLevel = 6) {
  let changed = false;
  const lines = content.split('\n');
  const result = [];
  let lastHeadingLevel = null;
  
  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    
    if (match) {
      const currentLevel = match[1].length;
      const text = match[2];
      
      // Determine appropriate level
      let newLevel = currentLevel;
      
      // Apply min/max constraints
      newLevel = Math.max(minLevel, Math.min(maxLevel, newLevel));
      
      // If jump is too large (e.g., # to ###), reduce jump
      if (lastHeadingLevel !== null && newLevel > lastHeadingLevel + 1) {
        newLevel = lastHeadingLevel + 1;
      }
      
      if (newLevel !== currentLevel) {
        changed = true;
        result.push('#'.repeat(newLevel) + ' ' + text);
      } else {
        result.push(line);
      }
      
      lastHeadingLevel = newLevel;
    } else {
      result.push(line);
    }
  }
  
  return { content: result.join('\n'), changed };
}

/**
 * Normalize whitespace in markdown
 * - Remove trailing whitespace
 * - Ensure blank lines between sections
 * - Fix multiple consecutive blank lines (max 1)
 * @param {string} content - Content to process
 * @returns {Object} - { content, changed }
 */
function normalizeWhitespace(content) {
  let changed = false;
  
  // Remove trailing whitespace from each line
  let updated = content.split('\n').map(line => line.replace(/\s+$/, '')).join('\n');
  if (updated !== content) changed = true;
  content = updated;
  
  // Reduce multiple blank lines to single blank line (max 2 consecutive newlines)
  updated = content.replace(/\n{3,}/g, '\n\n');
  if (updated !== content) changed = true;
  content = updated;
  
  // Ensure blank line after headings (except if followed by another heading or blank line)
  updated = content.replace(/^(#{1,6}\s+.+)\n(?!#|\s*$)/gm, '$1\n\n');
  if (updated !== content) changed = true;
  content = updated;
  
  // Ensure blank line after list blocks (except if followed by another list or blank)
  updated = content.replace(/^(\s*-\s+.+)\n(?![\s-]|\n|$)/gm, '$1\n\n');
  if (updated !== content) changed = true;
  content = updated;
  
  return { content, changed };
}

/**
 * Format a single note by path
 * @param {string} notePath - Path to note file
 * @param {Object} options - Formatting options
 *   - dryRun: boolean - Preview changes without saving
 *   - preserveOriginal: boolean - Keep backup of original
 *   - backup: string - Backup directory (default: ".backups")
 * @returns {Promise<Object>} - { success, path, changed, details, backup, error }
 */
async function formatNote(notePath, options = {}) {
  const {
    dryRun = false,
    preserveOriginal = true,
    backup = '.backups'
  } = options;
  
  try {
    // Read note
    let content;
    try {
      content = await fs.readFile(notePath, 'utf-8');
    } catch (err) {
      return {
        success: false,
        path: notePath,
        error: `Failed to read: ${err.message}`
      };
    }
    
    // Parse frontmatter
    const { frontmatter, body, hasFrontmatter } = parseFrontmatter(content);
    
    // Format markdown body
    const formatResult = formatMarkdown(body, options);
    
    // Reconstruct content
    let formatted;
    if (hasFrontmatter) {
      formatted = `---\n${frontmatter}\n---\n${formatResult.formatted}`;
    } else {
      formatted = formatResult.formatted;
    }
    
    // Sanitize for Unicode safety
    formatted = sanitizeUnicode(formatted);
    
    // Check if changed
    const changed = formatResult.changed || (formatted !== content);
    
    // Write backup if needed and content changed
    let backupPath = null;
    if (preserveOriginal && changed && !dryRun) {
      try {
        const backupDir = path.dirname(notePath) === '.' ? backup : path.join(path.dirname(notePath), backup);
        await fs.mkdir(backupDir, { recursive: true });
        
        const filename = path.basename(notePath);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        backupPath = path.join(backupDir, `${timestamp}--${filename}`);
        
        await fs.writeFile(backupPath, content, 'utf-8');
      } catch (err) {
        console.warn(`Warning: Failed to create backup: ${err.message}`);
      }
    }
    
    // Write formatted content if changed and not dry-run
    if (changed && !dryRun) {
      try {
        await fs.writeFile(notePath, formatted, 'utf-8');
      } catch (err) {
        return {
          success: false,
          path: notePath,
          error: `Failed to write: ${err.message}`
        };
      }
    }
    
    return {
      success: true,
      path: notePath,
      changed,
      details: formatResult.details,
      backup: backupPath,
      dryRun
    };
    
  } catch (err) {
    return {
      success: false,
      path: notePath,
      error: `Unexpected error: ${err.message}`
    };
  }
}

/**
 * Format multiple notes matching a filter
 * @param {Array<string>|string} filePaths - Glob patterns or explicit paths
 * @param {Object} options - Formatting options (same as formatNote)
 * @returns {Promise<Object>} - { total, succeeded, failed, results }
 */
async function formatMultiple(filePaths, options = {}) {
  const { limit = 100 } = options;
  
  // Convert string to array
  const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
  
  const results = [];
  let processed = 0;
  
  // Expand glob patterns
  const glob = require('glob');
  
  for (const pattern of paths) {
    if (processed >= limit) break;
    
    try {
      const files = await new Promise((resolve, reject) => {
        glob(pattern, (err, matches) => {
          if (err) reject(err);
          else resolve(matches);
        });
      });
      
      for (const file of files) {
        if (processed >= limit) break;
        
        const result = await formatNote(file, options);
        results.push(result);
        processed++;
      }
    } catch (err) {
      results.push({
        success: false,
        path: pattern,
        error: `Failed to expand pattern: ${err.message}`
      });
    }
  }
  
  const succeeded = results.filter(r => r.success && r.changed).length;
  const failed = results.filter(r => !r.success).length;
  
  return {
    total: results.length,
    succeeded,
    failed,
    results
  };
}

module.exports = {
  formatNote,
  formatMultiple,
  formatMarkdown,
  sanitizeUnicode,
  parseFrontmatter,
  standardizeListMarkers,
  enhanceTables,
  normalizeHeadingLevels,
  normalizeWhitespace
};
