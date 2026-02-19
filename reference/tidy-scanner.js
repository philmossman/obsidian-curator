/**
 * Tidy Scanner - Rule-based issue detection for vault housekeeping
 * Phase 4.3: /tidy command
 *
 * Detects:
 *   - Exact duplicates (same filename + same byte size)
 *   - Diverged duplicates (same filename, different size)
 *   - Structure violations (notes outside canonical folders)
 *   - Dead notes (0-byte, test filenames, tiny stubs)
 *
 * Returns structured issue list with confidence scores.
 */

const VaultClient = require('./vault-client');
const loadConfig = require('./config');
const path = require('path');

// System folders: NEVER touch
const SYSTEM_FOLDER_PREFIXES = ['logs/', 'ix:iphone/', 'ix:macbook/'];

// Root-level notes that are allowed to stay at root
const ROOT_EXCEPTIONS = ['index.md', 'welcome.md'];

// Default canonical folders (overridden by config.tidy.canonicalFolders)
const DEFAULT_CANONICAL_FOLDERS = [
  'inbox', 'Projects', 'Areas', 'Research', 'Photography',
  'Atlas', 'Archives', 'Resources', 'Slipbox'
];

// Byte threshold below which a note is considered "tiny" (candidate for stub check)
const TINY_NOTE_THRESHOLD = 300;

// ────────────────────────────────────────────────────────────────────────────
// Path helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the path lives inside a system folder that must never be touched.
 * Case-insensitive to handle e.g. "ix:iPhone" vs "ix:iphone".
 */
function isSystemPath(notePath) {
  if (!notePath) return true;
  const lower = notePath.toLowerCase();
  return SYSTEM_FOLDER_PREFIXES.some(prefix => lower.startsWith(prefix));
}

/**
 * Returns the top-level folder name, or null if the note is at the vault root.
 * e.g. "Projects/foo/bar.md" → "Projects"
 *      "note.md"             → null
 */
function getTopLevelFolder(notePath) {
  const parts = notePath.split('/');
  return parts.length > 1 ? parts[0] : null;
}

/** Returns true if the note lives directly at the vault root (no slashes). */
function isAtRoot(notePath) {
  return !notePath.includes('/');
}

/** Returns true if a root-level note is one of the permitted exceptions. */
function isRootException(notePath) {
  return ROOT_EXCEPTIONS.includes(path.basename(notePath).toLowerCase());
}

/** Returns true if a path's canonical top-level folder is in the allowed list. */
function isInCanonicalFolder(notePath, canonicalFolders) {
  const top = getTopLevelFolder(notePath);
  if (!top) return false;
  return canonicalFolders.map(f => f.toLowerCase()).includes(top.toLowerCase());
}

/**
 * Returns true if the filename is a well-known "intentionally short" note
 * (README, INDEX, etc.) that should not be flagged as a dead stub.
 */
function isIndexOrReadme(notePath) {
  const lower = path.basename(notePath).toLowerCase();
  const name = path.basename(notePath, path.extname(notePath)).toLowerCase();
  // Common intentionally-short filenames used for navigation/orientation
  const SKIP_NAMES = ['readme', 'index', '__readme', '_readme', '_index'];
  return SKIP_NAMES.includes(name);
}

/**
 * Returns true if the filename looks like a test/throwaway note.
 * Conservative: only matches clear test patterns to avoid false positives.
 */
function isTestFilename(notePath) {
  const base = path.basename(notePath, path.extname(notePath));
  const lower = base.toLowerCase();
  return (
    lower === 'test' ||
    lower.startsWith('test-') ||
    lower.startsWith('untitled') ||
    lower.startsWith('wikilink')
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Duplicate detection
// ────────────────────────────────────────────────────────────────────────────

/**
 * Detect duplicate notes (same filename).
 * - Same filename + same size → exact duplicate, high confidence
 * - Same filename + different sizes → diverged, needs AI triage
 *
 * @param {Array} notes - All vault notes (pre-filtered, no system paths)
 * @param {string[]} canonicalFolders - List of canonical top-level folders
 * @returns {Array} Issues
 */
function detectDuplicates(notes, canonicalFolders) {
  const issues = [];

  // Group by lowercase filename (basename only)
  const byFilename = {};
  for (const note of notes) {
    const key = path.basename(note.path).toLowerCase();
    if (!byFilename[key]) byFilename[key] = [];
    byFilename[key].push(note);
  }

  for (const [, group] of Object.entries(byFilename)) {
    if (group.length < 2) continue;

    // Sub-group by size
    const bySizeMap = {};
    for (const note of group) {
      const sz = (note.size != null && note.size > 0) ? note.size : null;
      const key = sz !== null ? String(sz) : '__unknown__';
      if (!bySizeMap[key]) bySizeMap[key] = [];
      bySizeMap[key].push(note);
    }

    // Exact duplicates: same filename AND same known size, multiple copies
    for (const [sizeKey, sameSize] of Object.entries(bySizeMap)) {
      if (sizeKey === '__unknown__') continue; // can't confirm without size
      if (sameSize.length < 2) continue;

      // Rank copies: prefer canonical folder, then deeper path (more specific)
      const sorted = [...sameSize].sort((a, b) => {
        const aC = isInCanonicalFolder(a.path, canonicalFolders);
        const bC = isInCanonicalFolder(b.path, canonicalFolders);
        if (aC && !bC) return -1;
        if (!aC && bC) return 1;
        // Prefer Projects/ over other canonical folders
        const aPref = a.path.toLowerCase().startsWith('projects/') ? 0 : 1;
        const bPref = b.path.toLowerCase().startsWith('projects/') ? 0 : 1;
        if (aPref !== bPref) return aPref - bPref;
        // Deeper path = more specific (prefer)
        return b.path.split('/').length - a.path.split('/').length;
      });

      const canonical = sorted[0];
      for (const dupe of sorted.slice(1)) {
        // High confidence if dupe is NOT in a canonical folder
        const confidence = isInCanonicalFolder(dupe.path, canonicalFolders) ? 0.72 : 0.92;
        issues.push({
          type: 'duplicate',
          subtype: 'exact',
          path: dupe.path,
          confidence,
          reason: `Exact duplicate of ${canonical.path} (same filename + ${sizeKey} bytes)`,
          suggestedAction: 'delete',
          relatedPaths: [canonical.path]
        });
      }
    }

    // Diverged duplicates: same filename but different sizes — only flag if
    // at least one copy is clearly out of place (root non-exception, or
    // non-canonical folder).  Generic filenames like README.md in separate
    // project folders are intentionally separate files, not duplicates.
    const knownSizes = Object.keys(bySizeMap).filter(k => k !== '__unknown__');
    if (knownSizes.length > 1) {
      // Find copies that are misplaced (at root without exception, or non-canonical folder)
      const misplacedCopies = group.filter(note =>
        (isAtRoot(note.path) && !isRootException(note.path)) ||
        (!isAtRoot(note.path) && !isInCanonicalFolder(note.path, canonicalFolders))
      );

      // Only flag if there are misplaced copies AND at least one canonical copy
      const canonicalCopies = group.filter(note => !misplacedCopies.includes(note));

      if (misplacedCopies.length > 0 && canonicalCopies.length > 0) {
        for (const note of misplacedCopies) {
          if (issues.some(i => i.path === note.path && i.type === 'duplicate')) continue;
          const others = canonicalCopies.map(n => n.path);
          issues.push({
            type: 'duplicate',
            subtype: 'diverged',
            path: note.path,
            confidence: 0.5,
            reason: `Possible duplicate of ${others.slice(0, 2).join(', ')} (same filename, different sizes — may have diverged)`,
            suggestedAction: 'flag',
            relatedPaths: others
          });
        }
      }
    }
  }

  return issues;
}

// ────────────────────────────────────────────────────────────────────────────
// Structure violation detection
// ────────────────────────────────────────────────────────────────────────────

/**
 * Detect notes that are outside the canonical folder structure.
 *
 * @param {Array} notes - All vault notes (pre-filtered)
 * @param {string[]} canonicalFolders
 * @returns {Array} Issues
 */
function detectStructureViolations(notes, canonicalFolders) {
  const issues = [];

  for (const note of notes) {
    if (isAtRoot(note.path)) {
      if (isRootException(note.path)) continue;

      // Root-level test/stub → high confidence delete
      if (isTestFilename(note.path) || (note.size || 0) === 0) {
        issues.push({
          type: 'structure',
          subtype: 'root-stub',
          path: note.path,
          confidence: 0.92,
          reason: 'Root-level note with test/placeholder filename or empty content',
          suggestedAction: 'delete',
          relatedPaths: []
        });
      } else {
        // Root-level real note → needs AI to route it
        issues.push({
          type: 'structure',
          subtype: 'root-misplaced',
          path: note.path,
          confidence: 0.62,
          reason: 'Note at vault root (should be inside a canonical folder)',
          suggestedAction: 'move',
          relatedPaths: []
        });
      }
    } else {
      // Note in a folder — check if top-level folder is canonical
      const top = getTopLevelFolder(note.path);
      if (top && !isInCanonicalFolder(note.path, canonicalFolders)) {
        issues.push({
          type: 'structure',
          subtype: 'non-canonical-folder',
          path: note.path,
          confidence: 0.82,
          reason: `In non-canonical top-level folder "${top}"`,
          suggestedAction: 'move',
          relatedPaths: []
        });
      }
    }
  }

  return issues;
}

// ────────────────────────────────────────────────────────────────────────────
// Dead note / stub detection
// ────────────────────────────────────────────────────────────────────────────

/**
 * Detect dead / stub notes.
 *   - 0 bytes: high confidence delete
 *   - Test filename patterns: high confidence delete
 *   - Very small content (<300 bytes): low confidence, AI triage
 *
 * @param {Array} notes - All vault notes
 * @returns {Array} Issues
 */
function detectDeadNotes(notes) {
  const issues = [];

  for (const note of notes) {
    const size = note.size || 0;
    const base = path.basename(note.path, path.extname(note.path));

    if (size === 0) {
      issues.push({
        type: 'stub',
        subtype: 'empty',
        path: note.path,
        confidence: 0.95,
        reason: '0-byte note (completely empty)',
        suggestedAction: 'delete',
        relatedPaths: []
      });
    } else if (isTestFilename(note.path)) {
      issues.push({
        type: 'stub',
        subtype: 'test-filename',
        path: note.path,
        confidence: 0.87,
        reason: `Test/placeholder filename: "${base}"`,
        suggestedAction: 'delete',
        relatedPaths: []
      });
    } else if (size > 0 && size < TINY_NOTE_THRESHOLD) {
      // Skip inbox notes — they're captures awaiting /process, not abandoned drafts
      if (note.path.startsWith('inbox/')) continue;
      // Skip root exceptions (Index.md, Welcome.md)
      if (isAtRoot(note.path) && isRootException(note.path)) continue;
      // Skip well-known "intentionally short" filenames (README, INDEX, etc.)
      if (isIndexOrReadme(note.path)) continue;
      issues.push({
        type: 'stub',
        subtype: 'tiny',
        path: note.path,
        confidence: 0.38,
        reason: `Very short note (${size} bytes) — may be abandoned draft`,
        suggestedAction: 'flag',
        relatedPaths: []
      });
    }
  }

  return issues;
}

// ────────────────────────────────────────────────────────────────────────────
// Main scanner entry point
// ────────────────────────────────────────────────────────────────────────────

/**
 * Scan all vault notes for housekeeping issues.
 *
 * @param {Object} options
 * @param {string[]} options.checks - ['dupes','structure','stubs'] or ['all']
 * @returns {Promise<{ notes, issues, canonicalFolders }>}
 */
async function scanVault(options = {}) {
  const config = loadConfig();
  const canonicalFolders = (config.tidy && config.tidy.canonicalFolders)
    ? config.tidy.canonicalFolders
    : DEFAULT_CANONICAL_FOLDERS;

  const checks = options.checks || ['all'];
  const runAll = checks.includes('all');
  const runDupes = runAll || checks.includes('dupes');
  const runStructure = runAll || checks.includes('structure');
  const runStubs = runAll || checks.includes('stubs');

  const vault = new VaultClient(config.couchdb);
  const allNotes = await vault.listNotes();

  // Filter out system folders entirely
  const notes = allNotes.filter(n => n.path && !isSystemPath(n.path));

  const issues = [];

  if (runDupes) {
    issues.push(...detectDuplicates(notes, canonicalFolders));
  }

  if (runStructure) {
    issues.push(...detectStructureViolations(notes, canonicalFolders));
  }

  if (runStubs) {
    issues.push(...detectDeadNotes(notes));
  }

  // Deduplicate issues by path: keep highest-confidence issue per path
  // (a note might be flagged as both a duplicate and a structure violation)
  const dedupedIssues = deduplicateByPath(issues);

  return { notes, issues: dedupedIssues, canonicalFolders, rawIssueCount: issues.length };
}

/**
 * Deduplicate issue list by path, keeping the highest-confidence entry.
 */
function deduplicateByPath(issues) {
  const byPath = {};
  for (const issue of issues) {
    if (!byPath[issue.path] || issue.confidence > byPath[issue.path].confidence) {
      byPath[issue.path] = issue;
    }
  }
  return Object.values(byPath);
}

module.exports = {
  scanVault,
  detectDuplicates,
  detectStructureViolations,
  detectDeadNotes,
  deduplicateByPath,
  isSystemPath,
  isAtRoot,
  isRootException,
  isInCanonicalFolder,
  isTestFilename,
  isIndexOrReadme,
  getTopLevelFolder,
  DEFAULT_CANONICAL_FOLDERS,
  TINY_NOTE_THRESHOLD
};
