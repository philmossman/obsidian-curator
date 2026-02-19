/**
 * Learning - Track user corrections and improve filing suggestions
 * Learns from manual corrections to improve future auto-filing
 */

const fs = require('fs').promises;
const path = require('path');
const { sanitizeUnicode } = require('./vault-client');

const LEARNING_DATA_PATH = path.join(__dirname, 'learning-data.json');

/**
 * Track a user correction (when user manually moves a note)
 * @param {string} originalPath - Original path (where AI suggested)
 * @param {string} correctedPath - Corrected path (where user moved it)
 * @param {string} content - Note content (for pattern analysis)
 * @returns {Promise<void>}
 */
async function trackCorrection(originalPath, correctedPath, content) {
  const data = await loadLearningData();
  
  // Extract folders
  const originalFolder = path.dirname(originalPath);
  const correctedFolder = path.dirname(correctedPath);
  
  if (originalFolder === correctedFolder) {
    // No folder change, skip
    return;
  }
  
  // Initialize corrections array if needed
  if (!data.corrections) {
    data.corrections = [];
  }
  
  // Extract keywords from content (simple keyword extraction)
  const keywords = extractKeywords(content);
  
  // Record correction
  data.corrections.push({
    timestamp: Date.now(),
    originalFolder,
    correctedFolder,
    keywords: keywords.slice(0, 10), // Keep top 10 keywords
    noteBasename: path.basename(correctedPath)
  });
  
  // Update folder patterns
  updateFolderPatterns(data, correctedFolder, keywords);
  
  // Limit history size (keep last 1000 corrections)
  if (data.corrections.length > 1000) {
    data.corrections = data.corrections.slice(-1000);
  }
  
  await saveLearningData(data);
}

/**
 * Get folder hints based on note content and learning history
 * @param {string} noteContent - Note content to analyze
 * @returns {Promise<Object>} Hints object with suggestedFolder and confidence
 */
async function getFolderHints(noteContent) {
  const data = await loadLearningData();
  
  if (!data.folderPatterns || Object.keys(data.folderPatterns).length === 0) {
    return { suggestedFolder: null, confidence: 0 };
  }
  
  // Extract keywords from note
  const keywords = extractKeywords(noteContent);
  
  // Score each folder based on keyword matches
  const scores = {};
  
  for (const [folder, patterns] of Object.entries(data.folderPatterns)) {
    let score = 0;
    
    for (const keyword of keywords) {
      if (patterns.keywords[keyword]) {
        score += patterns.keywords[keyword]; // Weight by frequency
      }
    }
    
    // Normalize by total patterns count
    scores[folder] = score / (patterns.count || 1);
  }
  
  // Find highest scoring folder
  let bestFolder = null;
  let bestScore = 0;
  
  for (const [folder, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestFolder = folder;
    }
  }
  
  // Convert score to confidence (0-1)
  const confidence = Math.min(bestScore / 10, 1.0); // Scale factor
  
  return {
    suggestedFolder: bestFolder,
    confidence: confidence,
    scores // Return all scores for debugging
  };
}

/**
 * Update folder patterns based on a correction
 * @param {Object} data - Learning data
 * @param {string} folder - Folder path
 * @param {Array<string>} keywords - Keywords from note
 */
function updateFolderPatterns(data, folder, keywords) {
  if (!data.folderPatterns) {
    data.folderPatterns = {};
  }
  
  if (!data.folderPatterns[folder]) {
    data.folderPatterns[folder] = {
      count: 0,
      keywords: {}
    };
  }
  
  const pattern = data.folderPatterns[folder];
  pattern.count++;
  
  // Update keyword frequencies
  for (const keyword of keywords) {
    pattern.keywords[keyword] = (pattern.keywords[keyword] || 0) + 1;
  }
}

/**
 * Extract keywords from note content (simple word frequency)
 * @param {string} content - Note content
 * @returns {Array<string>} Top keywords
 */
function extractKeywords(content) {
  // Remove frontmatter and markdown syntax
  const cleaned = content
    .replace(/---[\s\S]*?---/, '') // Remove frontmatter
    .replace(/[#*`[\]()]/g, ' ') // Remove markdown symbols
    .toLowerCase();
  
  // Split into words
  const words = cleaned.split(/\s+/)
    .filter(w => w.length > 3) // Min length 4
    .filter(w => !isStopWord(w));
  
  // Count frequency
  const freq = {};
  for (const word of words) {
    freq[word] = (freq[word] || 0) + 1;
  }
  
  // Sort by frequency
  const sorted = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word);
  
  return sorted.slice(0, 20); // Top 20 keywords
}

/**
 * Check if word is a common stop word
 * @param {string} word - Word to check
 * @returns {boolean} True if stop word
 */
function isStopWord(word) {
  const stopWords = new Set([
    'this', 'that', 'with', 'from', 'have', 'will', 'been',
    'were', 'their', 'what', 'which', 'when', 'where', 'there',
    'about', 'would', 'could', 'should', 'these', 'those'
  ]);
  
  return stopWords.has(word);
}

/**
 * Load learning data from disk
 * @returns {Promise<Object>} Learning data
 */
async function loadLearningData() {
  try {
    const raw = await fs.readFile(LEARNING_DATA_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // File doesn't exist yet, return empty data
      return {
        corrections: [],
        folderPatterns: {},
        version: 1
      };
    }
    throw err;
  }
}

/**
 * Save learning data to disk
 * @param {Object} data - Learning data to save
 * @returns {Promise<void>}
 */
async function saveLearningData(data) {
  // Sanitize all string data before saving
  const sanitized = sanitizeObject(data);
  
  const json = JSON.stringify(sanitized, null, 2);
  await fs.writeFile(LEARNING_DATA_PATH, json, 'utf8');
}

/**
 * Recursively sanitize all strings in an object
 * @param {*} obj - Object to sanitize
 * @returns {*} Sanitized object
 */
function sanitizeObject(obj) {
  if (typeof obj === 'string') {
    return sanitizeUnicode(obj);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }
  
  if (obj && typeof obj === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeObject(value);
    }
    return sanitized;
  }
  
  return obj;
}

/**
 * Get learning statistics
 * @returns {Promise<Object>} Statistics about learning data
 */
async function getStats() {
  const data = await loadLearningData();
  
  return {
    totalCorrections: data.corrections?.length || 0,
    foldersLearned: Object.keys(data.folderPatterns || {}).length,
    lastCorrectionDate: data.corrections?.length > 0
      ? new Date(data.corrections[data.corrections.length - 1].timestamp).toISOString()
      : null
  };
}

module.exports = {
  trackCorrection,
  getFolderHints,
  loadLearningData,
  saveLearningData,
  getStats
};
