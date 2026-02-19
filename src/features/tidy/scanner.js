'use strict';

/**
 * Tidy Scanner — rule-based issue detection for vault housekeeping.
 *
 * Detects:
 *   - Exact duplicates (same filename + same byte size)
 *   - Diverged duplicates (same filename, different sizes)
 *   - Structure violations (notes outside canonical folders)
 *   - Dead notes (0-byte, test filenames, tiny stubs)
 *
 * Config-driven: canonical folders, system paths, root exceptions, and
 * stub thresholds all come from config. No hardcoded values.
 */

const path = require('path');
const { getCanonicalFolders, getSystemPaths, getRootExceptions } = require('../../core/config');

// Default stub threshold (used if config.tidy.tinyNoteThreshold is not set)
const DEFAULT_TINY_NOTE_THRESHOLD = 300;

// ─────────────────────────────────────────────
// Path helpers
// ─────────────────────────────────────────────

/**
 * Returns true if the path lives inside a system path that must never be touched.
 * @param {string} notePath
 * @param {string[]} systemPaths - From config.structure.systemPaths
 * @returns {boolean}
 */
function isSystemPath(notePath, systemPaths) {
  if (!notePath) return true;
  const lower = notePath.toLowerCase();
  return systemPaths.some(prefix => lower.startsWith(prefix.toLowerCase()));
}

/**
 * Returns the top-level folder name, or null if the note is at vault root.
 * e.g. "Projects/foo/bar.md" → "Projects",  "note.md" → null
 * @param {string} notePath
 * @returns {string|null}
 */
function getTopLevelFolder(notePath) {
  const parts = notePath.split('/');
  return parts.length > 1 ? parts[0] : null;
}

/** Returns true if the note is directly at vault root (no slashes). */
function isAtRoot(notePath) {
  return !notePath.includes('/');
}

/**
 * Returns true if a root-level note is one of the permitted exceptions.
 * @param {string} notePath
 * @param {string[]} rootExceptions - From config.structure.rootExceptions
 */
function isRootException(notePath, rootExceptions) {
  return rootExceptions.map(e => e.toLowerCase()).includes(path.basename(notePath).toLowerCase());
}

/**
 * Returns true if the note is in one of the canonical folders.
 * @param {string}   notePath
 * @param {string[]} canonicalFolders
 */
function isInCanonicalFolder(notePath, canonicalFolders) {
  const top = getTopLevelFolder(notePath);
  if (!top) return false;
  return canonicalFolders.map(f => f.toLowerCase()).includes(top.toLowerCase());
}

/**
 * Returns true if the filename is a well-known "intentionally short" note
 * (README, INDEX, etc.) that should not be flagged as a dead stub.
 * @param {string} notePath
 */
function isIndexOrReadme(notePath) {
  const name = path.basename(notePath, path.extname(notePath)).toLowerCase();
  return ['readme', 'index', '__readme', '_readme', '_index'].includes(name);
}

/**
 * Returns true if the filename looks like a test/throwaway note.
 * Uses config.tidy.testPatterns (glob-style: test-*, Test*, Untitled*).
 *
 * @param {string}   notePath
 * @param {string[]} testPatterns - From config.tidy.testPatterns
 */
function isTestFilename(notePath, testPatterns) {
  const base = path.basename(notePath, path.extname(notePath));
  return testPatterns.some(pattern => {
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return base.toLowerCase().startsWith(prefix.toLowerCase());
    }
    return base.toLowerCase() === pattern.toLowerCase();
  });
}

// ─────────────────────────────────────────────
// Duplicate detection
// ─────────────────────────────────────────────

/**
 * Detect duplicate notes (same filename).
 *   - Same filename + same size → exact duplicate (high confidence delete)
 *   - Same filename + different sizes → diverged (flag for AI triage)
 *
 * @param {Array}    notes            - All vault notes (pre-filtered)
 * @param {string[]} canonicalFolders
 * @returns {Array}  Issues
 */
function detectDuplicates(notes, canonicalFolders) {
  const issues = [];

  // Group by lowercase basename
  const byFilename = {};
  for (const note of notes) {
    const key = path.basename(note.path).toLowerCase();
    if (!byFilename[key]) byFilename[key] = [];
    byFilename[key].push(note);
  }

  for (const group of Object.values(byFilename)) {
    if (group.length < 2) continue;

    // Sub-group by size
    const bySizeMap = {};
    for (const note of group) {
      const sz  = (note.size != null && note.size > 0) ? note.size : null;
      const key = sz !== null ? String(sz) : '__unknown__';
      if (!bySizeMap[key]) bySizeMap[key] = [];
      bySizeMap[key].push(note);
    }

    // Exact duplicates: same filename AND same known size
    for (const [sizeKey, sameSize] of Object.entries(bySizeMap)) {
      if (sizeKey === '__unknown__' || sameSize.length < 2) continue;

      // Rank: prefer canonical folder, then deeper path
      const sorted = [...sameSize].sort((a, b) => {
        const aC = isInCanonicalFolder(a.path, canonicalFolders);
        const bC = isInCanonicalFolder(b.path, canonicalFolders);
        if (aC && !bC) return -1;
        if (!aC && bC) return 1;
        const aPref = a.path.toLowerCase().startsWith('projects/') ? 0 : 1;
        const bPref = b.path.toLowerCase().startsWith('projects/') ? 0 : 1;
        if (aPref !== bPref) return aPref - bPref;
        return b.path.split('/').length - a.path.split('/').length;
      });

      const canonical = sorted[0];
      for (const dupe of sorted.slice(1)) {
        const confidence = isInCanonicalFolder(dupe.path, canonicalFolders) ? 0.72 : 0.92;
        issues.push({
          type:            'duplicate',
          subtype:         'exact',
          path:            dupe.path,
          confidence,
          reason:          `Exact duplicate of ${canonical.path} (same filename + ${sizeKey} bytes)`,
          suggestedAction: 'delete',
          relatedPaths:    [canonical.path]
        });
      }
    }

    // Diverged duplicates: same filename but different sizes
    const knownSizes = Object.keys(bySizeMap).filter(k => k !== '__unknown__');
    if (knownSizes.length > 1) {
      const misplaced   = group.filter(note =>
        (isAtRoot(note.path) && !isRootException(note.path, [])) ||
        (!isAtRoot(note.path) && !isInCanonicalFolder(note.path, canonicalFolders))
      );
      const canonical = group.filter(note => !misplaced.includes(note));

      if (misplaced.length > 0 && canonical.length > 0) {
        for (const note of misplaced) {
          if (issues.some(i => i.path === note.path && i.type === 'duplicate')) continue;
          issues.push({
            type:            'duplicate',
            subtype:         'diverged',
            path:            note.path,
            confidence:      0.5,
            reason:          `Possible duplicate of ${canonical.map(n => n.path).slice(0, 2).join(', ')} (same filename, different sizes)`,
            suggestedAction: 'flag',
            relatedPaths:    canonical.map(n => n.path)
          });
        }
      }
    }
  }

  return issues;
}

// ─────────────────────────────────────────────
// Structure violation detection
// ─────────────────────────────────────────────

/**
 * Detect notes outside the canonical folder structure.
 *
 * @param {Array}    notes            - Pre-filtered vault notes
 * @param {string[]} canonicalFolders
 * @param {string[]} rootExceptions   - From config
 * @param {string[]} testPatterns     - From config
 * @returns {Array}  Issues
 */
function detectStructureViolations(notes, canonicalFolders, rootExceptions, testPatterns) {
  const issues = [];

  for (const note of notes) {
    if (isAtRoot(note.path)) {
      if (isRootException(note.path, rootExceptions)) continue;

      if (isTestFilename(note.path, testPatterns) || (note.size || 0) === 0) {
        issues.push({
          type:            'structure',
          subtype:         'root-stub',
          path:            note.path,
          confidence:      0.92,
          reason:          'Root-level note with test/placeholder filename or empty content',
          suggestedAction: 'delete',
          relatedPaths:    []
        });
      } else {
        issues.push({
          type:            'structure',
          subtype:         'root-misplaced',
          path:            note.path,
          confidence:      0.62,
          reason:          'Note at vault root (should be inside a canonical folder)',
          suggestedAction: 'move',
          relatedPaths:    []
        });
      }
    } else {
      const top = getTopLevelFolder(note.path);
      if (top && !isInCanonicalFolder(note.path, canonicalFolders)) {
        issues.push({
          type:            'structure',
          subtype:         'non-canonical-folder',
          path:            note.path,
          confidence:      0.82,
          reason:          `In non-canonical top-level folder "${top}"`,
          suggestedAction: 'move',
          relatedPaths:    []
        });
      }
    }
  }

  return issues;
}

// ─────────────────────────────────────────────
// Dead note / stub detection
// ─────────────────────────────────────────────

/**
 * Detect dead / stub notes.
 *
 * @param {Array}    notes         - All vault notes
 * @param {string[]} testPatterns  - From config.tidy.testPatterns
 * @param {number}   tinyThreshold - From config.tidy.tinyNoteThreshold
 * @param {string}   inboxFolder   - From config.structure.folders.inbox
 * @param {string[]} rootExceptions
 * @returns {Array}  Issues
 */
function detectDeadNotes(notes, testPatterns, tinyThreshold, inboxFolder, rootExceptions) {
  const issues = [];

  for (const note of notes) {
    const size = note.size || 0;

    if (size === 0) {
      issues.push({
        type:            'stub',
        subtype:         'empty',
        path:            note.path,
        confidence:      0.95,
        reason:          '0-byte note (completely empty)',
        suggestedAction: 'delete',
        relatedPaths:    []
      });
    } else if (isTestFilename(note.path, testPatterns)) {
      issues.push({
        type:            'stub',
        subtype:         'test-filename',
        path:            note.path,
        confidence:      0.87,
        reason:          `Test/placeholder filename: "${path.basename(note.path, path.extname(note.path))}"`,
        suggestedAction: 'delete',
        relatedPaths:    []
      });
    } else if (size > 0 && size < tinyThreshold) {
      // Skip inbox (awaiting processing), root exceptions, and README/INDEX files
      if (note.path.startsWith(inboxFolder + '/') || note.path.startsWith(inboxFolder)) continue;
      if (isAtRoot(note.path) && isRootException(note.path, rootExceptions)) continue;
      if (isIndexOrReadme(note.path)) continue;

      issues.push({
        type:            'stub',
        subtype:         'tiny',
        path:            note.path,
        confidence:      0.38,
        reason:          `Very short note (${size} bytes) — may be abandoned draft`,
        suggestedAction: 'flag',
        relatedPaths:    []
      });
    }
  }

  return issues;
}

// ─────────────────────────────────────────────
// Deduplication
// ─────────────────────────────────────────────

/**
 * Deduplicate issues by path, keeping the highest-confidence entry.
 * @param {Array} issues
 * @returns {Array}
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

// ─────────────────────────────────────────────
// Main scanner entry point
// ─────────────────────────────────────────────

/**
 * Scan all vault notes for housekeeping issues.
 *
 * @param {Object}   vault  - VaultClient instance
 * @param {Object}   config - Loaded curator config
 * @param {Object}   [options]
 * @param {string[]} [options.checks] - ['dupes','structure','stubs'] or ['all']
 * @returns {Promise<{ notes, issues, canonicalFolders, rawIssueCount }>}
 */
async function scanVault(vault, config, options = {}) {
  const canonicalFolders = getCanonicalFolders(config);
  const systemPaths      = getSystemPaths(config);
  const rootExceptions   = getRootExceptions(config);
  const testPatterns     = (config.tidy && config.tidy.testPatterns)      || ['test-*', 'Test*', 'Untitled*'];
  const tinyThreshold    = (config.tidy && config.tidy.tinyNoteThreshold) || DEFAULT_TINY_NOTE_THRESHOLD;
  const inboxFolder      = (config.structure && config.structure.folders && config.structure.folders.inbox) || 'inbox';

  const checks    = options.checks || ['all'];
  const runAll    = checks.includes('all');
  const runDupes  = runAll || checks.includes('dupes');
  const runStruct = runAll || checks.includes('structure');
  const runStubs  = runAll || checks.includes('stubs');

  const allNotes = await vault.listNotes();

  // Filter out system paths
  const notes = allNotes.filter(n => n.path && !isSystemPath(n.path, systemPaths));

  const issues = [];

  if (runDupes)  issues.push(...detectDuplicates(notes, canonicalFolders));
  if (runStruct) issues.push(...detectStructureViolations(notes, canonicalFolders, rootExceptions, testPatterns));
  if (runStubs)  issues.push(...detectDeadNotes(notes, testPatterns, tinyThreshold, inboxFolder, rootExceptions));

  const dedupedIssues = deduplicateByPath(issues);

  return { notes, issues: dedupedIssues, canonicalFolders, rawIssueCount: issues.length };
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
  DEFAULT_TINY_NOTE_THRESHOLD
};
