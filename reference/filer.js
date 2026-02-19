/**
 * Filer - Phase 3: Auto-filing notes based on AI suggestions
 * Reads inbox notes with ai_suggestions, files them to target folders
 */

const VaultClient = require('./vault-client');
const loadConfig = require('./config');
const { trackOperation } = require('./undo');
const { getFolderHints } = require('./learning');
const path = require('path');
const crypto = require('crypto');

/**
 * File inbox notes based on AI suggestions
 * @param {Object} options - Filing options
 * @param {number} options.limit - Max notes to process (default: 10)
 * @param {number} options.minConfidence - Minimum confidence threshold (0.0-1.0, default: 0.7)
 * @param {boolean} options.dryRun - Preview without making changes (default: false)
 * @param {string} options.sessionId - Session ID for undo tracking (auto-generated if not provided)
 * @returns {Promise<Object>} Filing results
 */
async function fileNotes(options = {}) {
  const config = loadConfig();
  const vaultClient = new VaultClient(config.couchdb);
  
  // Apply defaults
  const limit = options.limit || 10;
  const minConfidence = options.minConfidence || 0.7;
  const dryRun = options.dryRun || false;
  const sessionId = options.sessionId || generateSessionId();
  
  const results = {
    sessionId,
    processed: 0,
    filed: 0,
    queued: 0,
    skipped: 0,
    failed: 0,
    details: [],
    dryRun
  };
  
  try {
    // Get inbox notes with ai_suggestions
    const inboxNotes = await getProcessedInboxNotes(vaultClient);
    
    if (inboxNotes.length === 0) {
      results.message = 'No processed notes found in inbox';
      return results;
    }
    
    // Process up to limit
    const notesToProcess = inboxNotes.slice(0, limit);
    
    for (const note of notesToProcess) {
      results.processed++;
      
      try {
        const result = await fileNote(vaultClient, note, {
          minConfidence,
          dryRun,
          sessionId
        });
        
        if (result.action === 'filed') {
          results.filed++;
        } else if (result.action === 'queued') {
          results.queued++;
        } else if (result.action === 'skipped') {
          results.skipped++;
        }
        
        results.details.push(result);
        
      } catch (err) {
        results.failed++;
        results.details.push({
          path: note.path,
          action: 'failed',
          error: err.message
        });
      }
    }
    
    return results;
    
  } catch (err) {
    throw new Error(`Filing failed: ${err.message}`);
  }
}

/**
 * Get inbox notes that have been processed by AI (have ai_suggestions)
 * @param {VaultClient} vaultClient - Vault client instance
 * @returns {Promise<Array>} Processed inbox notes
 */
async function getProcessedInboxNotes(vaultClient) {
  const config = loadConfig();
  const inboxPath = config.inbox.path || 'inbox/';
  
  const allNotes = await vaultClient.listNotes();
  const inboxNotes = allNotes.filter(n => n.path.startsWith(inboxPath));
  
  // Read each note and check for ai_suggestions
  const processed = [];
  
  for (const noteInfo of inboxNotes) {
    const note = await vaultClient.readNote(noteInfo.path);
    if (!note) continue;
    
    const { frontmatter, body } = vaultClient.parseFrontmatter(note.content);
    
    // Check if note has AI suggestions
    if (frontmatter.ai_suggestions) {
      processed.push({
        path: note.path,
        frontmatter,
        body,
        content: note.content
      });
    }
  }
  
  return processed;
}

/**
 * File a single note based on AI suggestions
 * @param {VaultClient} vaultClient - Vault client instance
 * @param {Object} note - Note object with frontmatter and body
 * @param {Object} options - Filing options
 * @returns {Promise<Object>} Filing result
 */
async function fileNote(vaultClient, note, options) {
  const { minConfidence, dryRun, sessionId } = options;
  const suggestions = note.frontmatter.ai_suggestions;
  
  // Check confidence level
  const confidence = parseConfidence(suggestions.confidence);
  
  if (confidence < minConfidence) {
    // Queue for manual review instead of filing
    return await queueForReview(vaultClient, note, dryRun, sessionId);
  }
  
  // Get folder hints from learning data
  const hints = await getFolderHints(note.body);
  const targetFolder = hints.suggestedFolder || suggestions.folder;
  
  // Build target path
  const fileName = path.basename(note.path);
  const targetPath = path.join(targetFolder, fileName);
  
  // Check if target folder exists, create if needed
  if (!dryRun) {
    await ensureFolderExists(vaultClient, targetFolder);
  }
  
  // Handle filename collision
  const finalPath = await resolveCollision(vaultClient, targetPath, dryRun);
  
  // Build updated note with tags and backlinks
  const updatedNote = buildUpdatedNote(vaultClient, note, suggestions);
  
  if (dryRun) {
    return {
      path: note.path,
      action: 'filed',
      targetPath: finalPath,
      tags: suggestions.tags || [],
      confidence: suggestions.confidence,
      preview: true
    };
  }
  
  // Write note to target location
  await vaultClient.writeNote(finalPath, updatedNote);
  
  // Delete original from inbox
  await vaultClient.deleteNote(note.path);
  
  // Track operation for undo
  trackOperation(sessionId, {
    action: 'file',
    originalPath: note.path,
    targetPath: finalPath,
    timestamp: Date.now(),
    originalContent: note.content,
    newContent: updatedNote
  });
  
  return {
    path: note.path,
    action: 'filed',
    targetPath: finalPath,
    tags: suggestions.tags || [],
    confidence: suggestions.confidence
  };
}

/**
 * Queue note for manual review (low confidence)
 * @param {VaultClient} vaultClient - Vault client instance
 * @param {Object} note - Note object
 * @param {boolean} dryRun - Preview mode
 * @param {string} sessionId - Session ID
 * @returns {Promise<Object>} Queue result
 */
async function queueForReview(vaultClient, note, dryRun, sessionId) {
  const queuePath = 'inbox/review-queue/' + path.basename(note.path);
  
  // Add review queue marker to frontmatter
  const frontmatter = { ...note.frontmatter };
  frontmatter.review_needed = true;
  frontmatter.queued_at = new Date().toISOString();
  
  const updatedContent = vaultClient.buildNote(frontmatter, note.body);
  
  if (dryRun) {
    return {
      path: note.path,
      action: 'queued',
      targetPath: queuePath,
      reason: 'Low confidence',
      preview: true
    };
  }
  
  // Ensure review-queue folder exists
  await ensureFolderExists(vaultClient, 'inbox/review-queue');
  
  // Move to review queue
  await vaultClient.writeNote(queuePath, updatedContent);
  await vaultClient.deleteNote(note.path);
  
  // Track operation
  trackOperation(sessionId, {
    action: 'queue',
    originalPath: note.path,
    targetPath: queuePath,
    timestamp: Date.now(),
    originalContent: note.content,
    newContent: updatedContent
  });
  
  return {
    path: note.path,
    action: 'queued',
    targetPath: queuePath,
    reason: 'Low confidence',
    confidence: note.frontmatter.ai_suggestions?.confidence
  };
}

/**
 * Build updated note with tags and backlinks applied
 * @param {VaultClient} vaultClient - Vault client instance (for buildNote)
 * @param {Object} note - Original note
 * @param {Object} suggestions - AI suggestions
 * @returns {string} Updated note content
 */
function buildUpdatedNote(vaultClient, note, suggestions) {
  const frontmatter = { ...note.frontmatter };
  
  // Add tags from suggestions
  if (suggestions.tags && suggestions.tags.length > 0) {
    frontmatter.tags = suggestions.tags;
  }
  
  // Mark as filed
  frontmatter.filed_at = new Date().toISOString();
  frontmatter.filed_by = 'vault-curator';
  
  // Remove ai_suggestions (no longer needed)
  delete frontmatter.ai_suggestions;
  
  // Add backlinks to body if related notes suggested
  let body = note.body;
  if (suggestions.related && suggestions.related.length > 0) {
    const backlinks = suggestions.related
      .map(notePath => `[[${notePath.replace(/\.md$/, '')}]]`)
      .join(' ');
    
    body = body + '\n\n## Related Notes\n' + backlinks;
  }
  
  return vaultClient.buildNote(frontmatter, body);
}

/**
 * Ensure folder exists by checking for any note in that folder
 * CouchDB doesn't have folders, but we track them via note paths
 * @param {VaultClient} vaultClient - Vault client instance
 * @param {string} folderPath - Folder path
 */
async function ensureFolderExists(vaultClient, folderPath) {
  // In CouchDB/Obsidian, folders exist implicitly when notes exist in them
  // We just need to make sure the path is valid
  // No action needed - folder will be created when first note is written
  return true;
}

/**
 * Resolve filename collision by adding numeric suffix
 * @param {VaultClient} vaultClient - Vault client instance
 * @param {string} targetPath - Target path
 * @param {boolean} dryRun - Preview mode
 * @returns {Promise<string>} Final path (possibly with suffix)
 */
async function resolveCollision(vaultClient, targetPath, dryRun) {
  if (dryRun) {
    // In dry run, just check if note exists
    const existing = await vaultClient.readNote(targetPath);
    if (existing) {
      // Return with -1 suffix for preview
      const parsed = path.parse(targetPath);
      return path.join(parsed.dir, `${parsed.name}-1${parsed.ext}`);
    }
    return targetPath;
  }
  
  // Check if target path exists
  let finalPath = targetPath;
  let counter = 1;
  
  while (await vaultClient.readNote(finalPath)) {
    // Collision detected, add numeric suffix
    const parsed = path.parse(targetPath);
    finalPath = path.join(parsed.dir, `${parsed.name}-${counter}${parsed.ext}`);
    counter++;
    
    if (counter > 100) {
      throw new Error(`Too many collisions for ${targetPath}`);
    }
  }
  
  return finalPath;
}

/**
 * Parse confidence string to number
 * @param {string} confidence - Confidence level (high/medium/low)
 * @returns {number} Numeric confidence (0.0-1.0)
 */
function parseConfidence(confidence) {
  if (typeof confidence === 'number') return confidence;
  
  const level = (confidence || '').toLowerCase();
  
  if (level === 'high') return 0.9;
  if (level === 'medium') return 0.6;
  if (level === 'low') return 0.3;
  
  // Try to parse as number
  const parsed = parseFloat(confidence);
  return isNaN(parsed) ? 0.5 : parsed;
}

/**
 * Generate unique session ID for undo tracking
 * @returns {string} Session ID
 */
function generateSessionId() {
  return `filer-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

module.exports = {
  fileNotes,
  fileNote,
  getProcessedInboxNotes,
  parseConfidence,
  generateSessionId
};
