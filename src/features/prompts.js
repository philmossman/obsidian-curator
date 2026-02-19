'use strict';

/**
 * prompts.js — Shared AI prompt templates for obsidian-curator.
 *
 * Single source of truth for prompts used across processor, filer,
 * tidy, and any other AI-powered features. Prompts are config-aware:
 * folder names and structure references come from config, never hardcoded.
 */

// ─────────────────────────────────────────────
// Note analysis (processor)
// ─────────────────────────────────────────────

/**
 * Build the prompt for AI note analysis (processor step).
 * The AI should return JSON with folder, tags, summary, confidence.
 *
 * @param {Object} note            - { path, body, frontmatter }
 * @param {Object} vaultStructure  - { folders: [{path, count}], noteCount }
 * @param {string[]} canonicalFolders - List of allowed top-level folders
 * @returns {string}
 */
function buildNoteAnalysisPrompt(note, vaultStructure, canonicalFolders) {
  const folders = vaultStructure.folders
    ? vaultStructure.folders.map(f => f.path).slice(0, 20).join(', ')
    : 'No folders yet';

  const canonicalList = canonicalFolders.join(', ');

  return `You are analyzing a note from an Obsidian vault to suggest how it should be organised.

NOTE PATH: ${note.path}

NOTE CONTENT:
${(note.body || note.content || '').slice(0, 2000)}

VAULT CONTEXT:
- Existing folders: ${folders}
- Canonical top-level folders: ${canonicalList}

TASK:
Analyse this note and suggest:
1. folder — Best folder to file this note (must be one of the canonical folders, or a sub-path beneath one)
2. tags — Relevant tags (2-5 short tags, no # prefix)
3. summary — One-line summary of the note (max 100 chars)
4. confidence — Your confidence level: "high", "medium", or "low"

Reply with ONLY valid JSON, no other text:
{
  "folder": "FolderName/optional-sub",
  "tags": ["tag1", "tag2"],
  "related": [],
  "summary": "Brief summary",
  "confidence": "high"
}`;
}

// ─────────────────────────────────────────────
// Filing (filer)
// ─────────────────────────────────────────────

/**
 * Build the prompt for AI filing decision.
 * The AI should return JSON with targetFolder, reasoning, confidence.
 *
 * @param {Object}   note            - { path, body, frontmatter }
 * @param {string[]} canonicalFolders
 * @returns {string}
 */
function buildFilingPrompt(note, canonicalFolders) {
  const suggestions = note.frontmatter && note.frontmatter.ai_suggestions;
  const suggestedFolder = suggestions ? suggestions.folder : 'unknown';

  return `You are deciding where to file a note in an Obsidian vault.

NOTE PATH: ${note.path}
AI SUGGESTION: ${suggestedFolder}

NOTE CONTENT (truncated):
${(note.body || '').slice(0, 1500)}

CANONICAL FOLDERS: ${canonicalFolders.join(', ')}

TASK:
Decide the best destination folder for this note. It MUST be one of the canonical
folders listed above, or a sub-path beneath one (e.g. "Projects/project-name").

Reply with ONLY valid JSON:
{
  "targetFolder": "FolderName",
  "reasoning": "One sentence explanation",
  "confidence": 0.85
}`;
}

// ─────────────────────────────────────────────
// Tidy AI triage prompts
// ─────────────────────────────────────────────

/** Maximum content characters to send in tidy prompts. */
const MAX_TIDY_CONTENT_CHARS = 1200;

/**
 * Build prompt for triaging a diverged duplicate.
 *
 * @param {Object}   issue
 * @param {string}   content
 * @param {Array}    relatedSnippets - Array of strings with content of related notes
 * @param {string[]} canonicalFolders
 * @returns {string}
 */
function buildDivergedDuplicatePrompt(issue, content, relatedSnippets, canonicalFolders) {
  return `You are a vault housekeeping assistant. Two notes share the same filename but have different content (they may have diverged).

NOTE UNDER REVIEW
Path: ${issue.path}
Content (truncated):
${content.slice(0, MAX_TIDY_CONTENT_CHARS)}

RELATED NOTE(S):
${relatedSnippets.join('\n\n---\n\n') || '(could not be read)'}

Canonical vault folders: ${canonicalFolders.join(', ')}

DECISION:
- delete: This note is clearly redundant; the canonical copy is elsewhere
- keep: Both notes serve different purposes and both should stay
- merge: The notes should be combined (flag for manual merge)
- flag: Uncertain — needs manual review

Reply with ONLY valid JSON, no markdown:
{
  "action": "delete|keep|merge|flag",
  "reasoning": "one sentence explanation",
  "targetPath": "path/to/canonical.md or null",
  "confidence": 0.0
}`;
}

/**
 * Build prompt for triaging a structure violation.
 *
 * @param {Object}   issue
 * @param {string}   content
 * @param {string[]} canonicalFolders
 * @returns {string}
 */
function buildStructureViolationPrompt(issue, content, canonicalFolders) {
  const filename = require('path').basename(issue.path);
  return `You are a vault housekeeping assistant. A note is outside the canonical folder structure.

NOTE UNDER REVIEW
Path: ${issue.path}
Issue: ${issue.reason}
Content (truncated):
${content.slice(0, MAX_TIDY_CONTENT_CHARS)}

Canonical vault folders: ${canonicalFolders.join(', ')}

DECISION:
- move: Move the note to the correct canonical folder (provide targetPath)
- delete: The note is throwaway/test/empty
- keep: The note is correctly placed
- flag: Uncertain — needs manual review

If action is "move", targetPath must be the full path including filename:
  e.g. "Projects/project-name/${filename}"

Reply with ONLY valid JSON:
{
  "action": "move|delete|keep|flag",
  "reasoning": "one sentence explanation",
  "targetPath": "canonical/folder/filename.md or null",
  "confidence": 0.0
}`;
}

/**
 * Build prompt for triaging a stub/dead note.
 *
 * @param {Object}   issue
 * @param {string}   content
 * @param {number}   wordCount
 * @param {string[]} canonicalFolders
 * @returns {string}
 */
function buildStubPrompt(issue, content, wordCount, canonicalFolders) {
  return `You are a vault housekeeping assistant. A note may be an abandoned draft or stub.

NOTE UNDER REVIEW
Path: ${issue.path}
Issue: ${issue.reason}
Word count: approximately ${wordCount}
Content:
${content.slice(0, MAX_TIDY_CONTENT_CHARS)}

DECISION:
- delete: Note is empty, contains only test content, or has been abandoned with no value
- keep: Note is a complete atomic note or has genuine reference value
- move: Note has value but is misplaced (provide targetPath)
- flag: Uncertain — needs manual review

Reply with ONLY valid JSON:
{
  "action": "delete|keep|move|flag",
  "reasoning": "one sentence explanation",
  "targetPath": "path/if/moving.md or null",
  "confidence": 0.0
}`;
}

/**
 * Build a generic triage prompt for any issue type.
 *
 * @param {Object}   issue
 * @param {string}   content
 * @param {string[]} canonicalFolders
 * @returns {string}
 */
function buildGenericTriagePrompt(issue, content, canonicalFolders) {
  return `You are a vault housekeeping assistant reviewing a note.

NOTE UNDER REVIEW
Path: ${issue.path}
Issue type: ${issue.type} (${issue.subtype || ''})
Issue: ${issue.reason}

Content (truncated):
${content.slice(0, MAX_TIDY_CONTENT_CHARS)}

Canonical vault folders: ${canonicalFolders.join(', ')}

DECISION: delete / move / keep / flag

Reply with ONLY valid JSON:
{
  "action": "delete|move|keep|flag",
  "reasoning": "one sentence explanation",
  "targetPath": null,
  "confidence": 0.0
}`;
}

// ─────────────────────────────────────────────
// Memory distill (for OpenClaw skill)
// ─────────────────────────────────────────────

/**
 * Build the memory extraction prompt for distillation.
 * Used by the OpenClaw skill wrapper's distill feature.
 *
 * @param {Array} memoryFiles - Array of { date, content } objects
 * @returns {string}
 */
function buildExtractionPrompt(memoryFiles) {
  const dateRange = memoryFiles.length > 0
    ? `${memoryFiles[memoryFiles.length - 1].date} to ${memoryFiles[0].date}`
    : 'unknown';

  return `You are analyzing daily memory logs to extract significant insights for permanent storage in an Obsidian vault.

INPUT: Memory logs from ${dateRange}

TASK: Extract insights that should become permanent vault notes.

EXTRACT:
- Key decisions made (chose approach, selected option, decided against)
- Lessons learned (technical discoveries, process improvements, mistakes identified)
- Project milestones (completions, major progress, releases)
- Technical discoveries (bugs fixed, solutions found, how things work)
- Reusable knowledge (how-tos, best practices, reference material)

SKIP:
- Routine tasks (daily briefs, email checks, calendar scans)
- Heartbeat/status messages
- Trivial updates or temporary notes
- Already-resolved issues
- Small fixes without broader learning

QUALITY STANDARDS:
- Only extract truly significant content worth preserving
- Prefer 3-8 high-quality insights over many trivial ones
- Group related items into single insight (don't fragment)
- Write for future-self (clear context, no assumed knowledge)
- Include enough detail to be useful months later

OUTPUT FORMAT (JSON):
{
  "insights": [
    {
      "type": "decision|lesson|milestone|discovery|reference",
      "topic": "project or subject area",
      "title": "Brief descriptive title (50 chars max)",
      "content": "Full markdown content (well-structured, with headings/lists)",
      "source_dates": ["2026-02-16"],
      "tags": ["tag1", "tag2"],
      "confidence": 0.6,
      "related_notes": ["potential vault note paths that might be related"]
    }
  ]
}

CONFIDENCE SCORING:
- 0.9-1.0: Major milestone, critical decision, significant technical discovery
- 0.7-0.9: Important lesson, useful reference, solid progress
- 0.6-0.7: Minor learning, small improvement, nice-to-have context
- <0.6: Skip (too trivial)

Return ONLY the JSON object, no other text.`;
}

module.exports = {
  buildNoteAnalysisPrompt,
  buildFilingPrompt,
  buildDivergedDuplicatePrompt,
  buildStructureViolationPrompt,
  buildStubPrompt,
  buildGenericTriagePrompt,
  buildExtractionPrompt,
  MAX_TIDY_CONTENT_CHARS
};
