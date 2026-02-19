#!/usr/bin/env node
/**
 * Vault-aware Note Formatter
 * Wraps formatter.js to work with CouchDB/VaultClient instead of local filesystem
 */

const VaultClient = require('../obsidian-curator/vault-client');
const config = require('../obsidian-curator/config.json');
const { 
  formatMarkdown, 
  parseFrontmatter, 
  sanitizeUnicode 
} = require('./formatter');

const vaultClient = new VaultClient(config.couchdb);

/**
 * Format a single note from the vault
 * @param {string} notePath - Vault path to note
 * @param {Object} options - Formatting options
 *   - dryRun: boolean - Preview changes without saving
 * @returns {Promise<Object>} - { success, path, changed, details, error }
 */
async function formatVaultNote(notePath, options = {}) {
  const { dryRun = false } = options;
  
  try {
    // Read from vault
    let noteDoc;
    try {
      noteDoc = await vaultClient.readNote(notePath);
    } catch (err) {
      return {
        success: false,
        path: notePath,
        error: `Failed to read from vault: ${err.message}`
      };
    }
    
    const content = noteDoc.content;
    
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
    
    // Write back to vault if changed and not dry-run
    if (changed && !dryRun) {
      try {
        await vaultClient.writeNote(notePath, formatted);
      } catch (err) {
        return {
          success: false,
          path: notePath,
          error: `Failed to write to vault: ${err.message}`
        };
      }
    }
    
    return {
      success: true,
      path: notePath,
      changed,
      details: formatResult.details,
      dryRun,
      preview: dryRun ? formatted : null
    };
    
  } catch (err) {
    return {
      success: false,
      path: notePath,
      error: err.message
    };
  }
}

/**
 * Format multiple vault notes by pattern
 * @param {string|Array} patterns - Note path patterns (supports "inbox/" prefix matching)
 * @param {Object} options - Formatting options
 * @returns {Promise<Object>} - { total, changed, failed, results }
 */
async function formatMultipleVaultNotes(patterns, options = {}) {
  const { limit = 10 } = options;
  
  try {
    // List all notes from vault
    const allNotes = await vaultClient.listNotes();
    
    // Filter by pattern
    const patternsArray = Array.isArray(patterns) ? patterns : [patterns];
    let matchedNotes = allNotes.filter(note => {
      return patternsArray.some(pattern => {
        if (pattern.endsWith('/*') || pattern.endsWith('/')) {
          const prefix = pattern.replace(/\/?\*?$/, '');
          return note.path.startsWith(prefix);
        }
        return note.path === pattern || note.path.includes(pattern);
      });
    });
    
    // Limit results
    matchedNotes = matchedNotes.slice(0, limit);
    
    // Format each note
    const results = [];
    for (const note of matchedNotes) {
      const result = await formatVaultNote(note.path, options);
      results.push(result);
    }
    
    return {
      total: results.length,
      changed: results.filter(r => r.success && r.changed).length,
      failed: results.filter(r => !r.success).length,
      results
    };
    
  } catch (err) {
    return {
      total: 0,
      changed: 0,
      failed: 1,
      results: [],
      error: err.message
    };
  }
}

/**
 * Handle /format command from Telegram (vault-aware)
 * @param {string} commandText - Full command text (e.g., "/format inbox/note.md")
 * @returns {Promise<string>} Response message
 */
async function handleFormatCommand(commandText = '') {
  const options = { dryRun: false };
  
  let targetPath = null;
  const args = commandText.split(/\s+/).slice(1); // Skip "/format"
  
  for (const arg of args) {
    if (arg.toLowerCase() === 'dryrun' || arg.toLowerCase() === 'dry-run') {
      options.dryRun = true;
    } else if (arg.toLowerCase() === 'inbox') {
      targetPath = 'inbox/';
    } else if (!arg.startsWith('-') && !arg.startsWith('/')) {
      targetPath = arg;
    }
  }
  
  try {
    let result;
    
    if (!targetPath) {
      // No path - error, we need a path
      return '❌ **Format Failed**\n\nUsage: `/format <path>` or `/format inbox`';
    } else if (targetPath.endsWith('/') || targetPath.includes('*')) {
      // Multiple notes
      result = await formatMultipleVaultNotes(targetPath, { ...options, limit: 50 });
      return formatMultipleResults(result, options);
    } else {
      // Single note
      result = await formatVaultNote(targetPath, options);
      return formatSingleResult(result, options);
    }
    
  } catch (err) {
    console.error('❌ Format failed:', err);
    return `❌ Formatting failed: ${err.message}`;
  }
}

/**
 * Format single result for Telegram
 */
function formatSingleResult(result, options) {
  if (!result.success) {
    return `❌ **Failed**\n${result.error}`;
  }
  
  if (!result.changed) {
    return `✅ **No Changes Needed**\n\n📝 ${result.path}\n\nNote is already well-formatted!`;
  }
  
  const lines = [];
  
  if (options.dryRun) {
    lines.push('🔍 **Dry Run - Preview**\n');
  } else {
    lines.push('✅ **Formatted Successfully**\n');
  }
  
  lines.push(`📝 ${result.path}`);
  
  if (result.details && result.details.length > 0) {
    lines.push('\n**Changes:**');
    result.details.forEach(detail => {
      if (detail.startsWith('Formatted')) lines.push(`  ✓ ${detail}`);
      else if (detail.startsWith('Normalized')) lines.push(`  ✓ ${detail}`);
      else if (detail.startsWith('Standardized')) lines.push(`  ✓ ${detail}`);
      else if (detail.startsWith('Added')) lines.push(`  ✓ ${detail}`);
      else lines.push(`  • ${detail}`);
    });
  }
  
  return lines.join('\n');
}

/**
 * Format multiple results for Telegram
 */
function formatMultipleResults(result, options) {
  const lines = [];
  
  if (options.dryRun) {
    lines.push('🔍 **Dry Run - Preview**\n');
  } else {
    lines.push('✅ **Batch Format Complete**\n');
  }
  
  lines.push(`📊 **Results:**`);
  lines.push(`  Total: ${result.total}`);
  lines.push(`  Changed: ${result.changed}`);
  lines.push(`  Unchanged: ${result.total - result.changed - result.failed}`);
  lines.push(`  Failed: ${result.failed}`);
  
  if (result.results && result.results.length > 0) {
    lines.push('\n**Details:**');
    result.results.slice(0, 10).forEach(r => {
      if (r.success && r.changed) {
        lines.push(`  ✓ ${r.path}`);
      } else if (!r.success) {
        lines.push(`  ✗ ${r.path}: ${r.error}`);
      }
    });
    
    if (result.results.length > 10) {
      lines.push(`  ... and ${result.results.length - 10} more`);
    }
  }
  
  return lines.join('\n');
}

module.exports = {
  formatVaultNote,
  formatMultipleVaultNotes,
  handleFormatCommand
};

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args.join(' ');
  
  if (!command || !command.startsWith('format')) {
    console.log('Usage: node vault-formatter.js format <path>');
    console.log('       node vault-formatter.js format inbox/');
    console.log('       node vault-formatter.js format dryrun <path>');
    process.exit(1);
  }
  
  handleFormatCommand(command).then(response => {
    console.log(response);
  }).catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
