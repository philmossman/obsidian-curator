#!/usr/bin/env node

/**
 * Vault Search with Relevance Scoring
 * 
 * Enhanced search for finding related notes with confidence scores.
 * Used by distiller to decide update vs create.
 */

const VaultClient = require('./vault-client');

/**
 * Get vault client instance
 */
function getVaultClient() {
  const config = require('./config')();
  return new VaultClient(config.couchdb);
}

/**
 * Search vault for notes related to a topic/insight.
 *
 * Two-pass approach:
 *   Pass 1: Score all notes by path only (cheap — no DB reads)
 *   Pass 2: Read content of top N candidates and re-score with full data
 *
 * @param {string} topic - Topic or project name
 * @param {string[]} tags - Associated tags
 * @param {string} content - Full content for semantic matching
 * @param {Object} options - { contentCandidates: number } — how many notes to read for content scoring (default: 10)
 * @returns {Promise<Array>} Array of {note, score, reasoning}
 */
async function searchRelated(topic, tags = [], content = '', options = {}) {
  const { contentCandidates = 10 } = options;
  const vault = getVaultClient();
  const allNotes = await vault.listNotes();

  // Pass 1: score by path only to find top candidates
  const pathScored = allNotes
    .map(note => ({
      note,
      pathScore: scoreByPath(note, topic, tags)
    }))
    .filter(({ pathScore }) => pathScore > 0)
    .sort((a, b) => b.pathScore - a.pathScore);

  // Pass 2: read content for top N candidates and full-score them
  const topCandidates = pathScored.slice(0, contentCandidates);
  const results = [];

  for (const { note, pathScore } of topCandidates) {
    let fullNote = note;

    // Attempt to read note content for richer scoring
    try {
      const read = await vault.readNote(note.path);
      if (read) {
        const { frontmatter, body } = vault.parseFrontmatter(read.content);
        fullNote = {
          ...note,
          content: body,
          tags: frontmatter.tags || []
        };
      }
    } catch (_) {
      // If read fails, fall back to path-only scoring
    }

    const score = calculateRelevance(fullNote, topic, tags, content);
    if (score > 0.3) {
      results.push({
        note: note.path,
        score,
        reasoning: explainScore(fullNote, topic, tags, score)
      });
    }
  }

  // Also include any non-top-candidate notes that scored > 0 on path alone
  // (but below content threshold) — scored at path level only
  const remainingPathMatches = pathScored.slice(contentCandidates)
    .map(({ note, pathScore }) => ({
      note: note.path,
      score: pathScore,
      reasoning: explainScore(note, topic, tags, pathScore)
    }))
    .filter(r => r.score > 0.3);

  const allResults = [...results, ...remainingPathMatches];
  allResults.sort((a, b) => b.score - a.score);

  return allResults;
}

/**
 * Score a note by path alone (no content read).
 * Used in Pass 1 to cheaply rank candidates.
 * @returns {number} Score 0.0-0.5 (path-only max)
 */
function scoreByPath(note, topic, tags) {
  let score = 0;
  const notePath = note.path.toLowerCase();
  const topicSlug = slugify(topic);

  if (notePath.includes(topicSlug)) {
    score += 0.4;
  } else if (notePath.includes(topic.toLowerCase())) {
    score += 0.3;
  } else {
    const pathParts = notePath.split('/');
    if (pathParts.some(part => part.includes(topicSlug))) {
      score += 0.2;
    }
  }

  // Living document bonus
  const livingDocPatterns = ['build-log', 'buildlog', 'changelog', 'action-plan', 'roadmap', 'todo', 'tasks', 'notes'];
  if (livingDocPatterns.some(p => notePath.includes(p))) {
    score += 0.1;
  }

  return score;
}

/**
 * Calculate relevance score for a note
 * @returns {number} Score 0.0-1.0
 */
function calculateRelevance(note, topic, tags, content) {
  let score = 0;
  const notePath = note.path.toLowerCase();
  const path = notePath; // alias for readability below
  // Derive title from filename (no separate title field in CouchDB metadata)
  const filename = notePath.split('/').pop().replace(/\.md$/, '').replace(/[-_]/g, ' ');
  const title = filename;
  const noteTags = note.tags || [];
  const noteContent = note.content?.toLowerCase() || '';

  // 1. Path matching (0.0-0.4)
  const topicSlug = slugify(topic);
  if (path.includes(topicSlug)) {
    score += 0.4; // Direct folder/filename match
  } else if (path.includes(topic.toLowerCase())) {
    score += 0.3; // Partial path match
  } else {
    // Check if topic appears in path components
    const pathParts = path.split('/');
    if (pathParts.some(part => part.includes(topicSlug))) {
      score += 0.2;
    }
  }

  // 2. Title matching (0.0-0.3)
  if (title.includes(topic.toLowerCase())) {
    score += 0.3;
  } else {
    // Partial word match
    const topicWords = topic.toLowerCase().split(/[\s-_]+/);
    const matchedWords = topicWords.filter(word => 
      word.length > 2 && title.includes(word)
    );
    score += (matchedWords.length / topicWords.length) * 0.2;
  }

  // 3. Tag overlap (0.0-0.2)
  if (tags.length > 0 && noteTags.length > 0) {
    const tagOverlap = tags.filter(tag => 
      noteTags.some(noteTag => 
        noteTag.toLowerCase().includes(tag.toLowerCase()) ||
        tag.toLowerCase().includes(noteTag.toLowerCase())
      )
    );
    score += (tagOverlap.length / tags.length) * 0.2;
  }

  // 4. Build log / living document detection (0.0-0.1)
  const livingDocPatterns = [
    'build-log', 'buildlog', 'changelog', 'change-log',
    'action-plan', 'roadmap', 'todo', 'tasks', 'notes'
  ];
  if (livingDocPatterns.some(pattern => path.includes(pattern) || title.includes(pattern))) {
    score += 0.1;
  }

  // 5. Content similarity (0.0-0.1) - basic keyword matching
  if (content && noteContent) {
    const contentWords = extractKeywords(content);
    const noteWords = extractKeywords(noteContent);
    const overlap = contentWords.filter(word => noteWords.includes(word));
    if (overlap.length > 0) {
      score += Math.min((overlap.length / contentWords.length) * 0.1, 0.1);
    }
  }

  return Math.min(score, 1.0); // Cap at 1.0
}

/**
 * Explain why a note got its score
 */
function explainScore(note, topic, tags, score) {
  const reasons = [];
  const path = note.path.toLowerCase();
  const title = note.title?.toLowerCase() || '';
  const noteTags = note.tags || [];

  if (path.includes(slugify(topic))) {
    reasons.push('folder/filename match');
  }
  if (title.includes(topic.toLowerCase())) {
    reasons.push('title match');
  }
  if (tags.some(tag => noteTags.some(nt => nt.toLowerCase().includes(tag.toLowerCase())))) {
    reasons.push('tag overlap');
  }
  if (path.includes('build-log') || path.includes('action-plan')) {
    reasons.push('living document');
  }

  return reasons.length > 0 ? reasons.join(', ') : 'partial match';
}

/**
 * Extract keywords from content for basic similarity
 */
function extractKeywords(text) {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'should', 'could', 'may', 'might', 'can', 'this', 'that', 'these',
    'those', 'it', 'its', 'they', 'them', 'their', 'we', 'our', 'you',
    'your', 'he', 'she', 'him', 'her'
  ]);

  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3 && !stopWords.has(word))
    .slice(0, 50); // Top 50 keywords
}

/**
 * Convert topic to URL-safe slug
 */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Find best match for update decision
 * @returns {Object|null} {note, score, reasoning} or null if no good match
 */
function findBestMatch(searchResults, threshold = 0.6) {
  if (searchResults.length === 0) return null;
  
  const best = searchResults[0];
  return best.score >= threshold ? best : null;
}

/**
 * Suggest folder for new note based on topic
 */
async function suggestFolder(topic, tags = []) {
  const vault = getVaultClient();
  const allNotes = await vault.listNotes();
  
  // Extract unique folders
  const folders = new Map();
  for (const note of allNotes) {
    const folder = note.path.substring(0, note.path.lastIndexOf('/'));
    if (folder) {
      folders.set(folder, (folders.get(folder) || 0) + 1);
    }
  }

  // Score folders by relevance
  const folderScores = [];
  for (const [folder, count] of folders.entries()) {
    let score = 0;
    const folderLower = folder.toLowerCase();
    const topicSlug = slugify(topic);

    // Direct topic match
    if (folderLower.includes(topicSlug)) {
      score += 0.5;
    }

    // Tag match
    if (tags.some(tag => folderLower.includes(tag.toLowerCase()))) {
      score += 0.3;
    }

    // Prefer Projects/ for active work
    if (folder.startsWith('Projects/')) {
      score += 0.2;
    }

    // Slight bonus for populated folders (but not too much)
    score += Math.min(count / 100, 0.1);

    if (score > 0) {
      folderScores.push({ folder, score });
    }
  }

  folderScores.sort((a, b) => b.score - a.score);

  // If no good match, default to Projects/
  if (folderScores.length === 0 || folderScores[0].score < 0.3) {
    return `Projects/${topicSlug}`;
  }

  return folderScores[0].folder;
}

module.exports = {
  searchRelated,
  findBestMatch,
  suggestFolder,
  calculateRelevance
};
