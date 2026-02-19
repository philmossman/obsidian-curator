/**
 * Tidy AI - AI triage for low-confidence housekeeping issues
 * Phase 4.3: /tidy command
 *
 * Uses Claude Haiku for speed and cost efficiency.
 * Reads note content and decides: delete / move / merge / keep / flag
 * Returns action + reasoning + target path.
 */

const VaultClient = require('./vault-client');
const { chat } = require('./ai-client');
const loadConfig = require('./config');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Minimum AI confidence to act on a decision (below this → flag for Phil)
const AI_ACT_THRESHOLD = 0.6;

// Maximum content length to send to AI (keep prompts cheap)
const MAX_CONTENT_CHARS = 1200;

// Memory directory to search for context
const MEMORY_DIR = path.join(os.homedir(), '.openclaw', 'workspace', 'memory');

// ────────────────────────────────────────────────────────────────────────────
// Memory context search
// ────────────────────────────────────────────────────────────────────────────

/**
 * Search memory files for references to a note.
 * Extracts meaningful keywords from the note path, then greps memory/*.md.
 * Returns a brief snippet if found, or null if not mentioned.
 *
 * @param {string} notePath - e.g. "inbox/2026-02-15-dog-food-order-i-ordered.md"
 * @returns {string|null} Context snippet or null
 */
function searchMemoryForNote(notePath) {
  try {
    if (!fs.existsSync(MEMORY_DIR)) return null;

    // Extract search terms: strip date prefix, split on hyphens/underscores
    const basename = path.basename(notePath, path.extname(notePath));
    const withoutDate = basename.replace(/^\d{4}-\d{2}-\d{2}[-_]?/, '');
    const keywords = withoutDate
      .split(/[-_\s]+/)
      .filter(w => w.length > 3)
      .slice(0, 5);

    if (keywords.length === 0) return null;

    // Also search for the raw path
    const searchTerms = [notePath, ...keywords];
    const snippets = [];

    const files = fs.readdirSync(MEMORY_DIR)
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse() // most recent first
      .slice(0, 14); // last ~2 weeks

    for (const file of files) {
      const content = fs.readFileSync(path.join(MEMORY_DIR, file), 'utf8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].toLowerCase();
        const matched = searchTerms.some(term => line.includes(term.toLowerCase()));
        if (matched) {
          // Grab surrounding context (line before + matched line + line after)
          const start = Math.max(0, i - 1);
          const end = Math.min(lines.length - 1, i + 1);
          const snippet = lines.slice(start, end + 1).join('\n').trim();
          snippets.push(`[${file}]: ${snippet}`);
          if (snippets.length >= 3) break; // cap at 3 snippets
        }
      }
      if (snippets.length >= 3) break;
    }

    return snippets.length > 0 ? snippets.join('\n---\n') : null;
  } catch (_) {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Batch triage
// ────────────────────────────────────────────────────────────────────────────

/**
 * Triage a batch of low-confidence issues with AI.
 *
 * @param {Array} issues - Issues to triage (confidence < threshold)
 * @param {Object} options - Optional overrides
 * @returns {Promise<Array>} Issues with `.aiDecision` added to each
 */
async function triageIssues(issues, options = {}) {
  const config = loadConfig();
  const vault = new VaultClient(config.couchdb);
  const canonicalFolders = (config.tidy && config.tidy.canonicalFolders)
    ? config.tidy.canonicalFolders
    : ['inbox', 'Projects', 'Areas', 'Research', 'Photography',
       'Atlas', 'Archives', 'Resources', 'Slipbox'];

  const results = [];

  for (const issue of issues) {
    try {
      const decision = await triageIssue(vault, issue, canonicalFolders, options);
      results.push({ ...issue, aiDecision: decision });
    } catch (err) {
      // AI failure → flag for manual review, never throw
      results.push({
        ...issue,
        aiDecision: {
          action: 'flag',
          reasoning: `AI triage failed: ${err.message}`,
          targetPath: null,
          confidence: 0
        }
      });
    }
  }

  return results;
}

// ────────────────────────────────────────────────────────────────────────────
// Single issue triage
// ────────────────────────────────────────────────────────────────────────────

/**
 * Triage a single issue with AI.
 *
 * @param {VaultClient} vault
 * @param {Object} issue
 * @param {string[]} canonicalFolders
 * @param {Object} options
 * @returns {Promise<Object>} { action, reasoning, targetPath, confidence }
 */
async function triageIssue(vault, issue, canonicalFolders, options = {}) {
  // Read note content
  const note = await vault.readNote(issue.path);
  if (!note) {
    return {
      action: 'delete',
      reasoning: 'Note no longer exists in vault',
      targetPath: null,
      confidence: 0.95
    };
  }

  const content = (note.content || '').trim();

  // Search memory files for references to this note
  const memoryContext = searchMemoryForNote(issue.path);

  let prompt;

  if (issue.type === 'duplicate' && issue.subtype === 'diverged') {
    prompt = await buildDivergedDuplicatePrompt(vault, issue, content, canonicalFolders, memoryContext);
  } else if (issue.type === 'structure') {
    prompt = buildStructurePrompt(issue, content, canonicalFolders, memoryContext);
  } else if (issue.type === 'stub') {
    const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
    prompt = buildStubPrompt(issue, content, wordCount, canonicalFolders, memoryContext);
  } else {
    prompt = buildGenericPrompt(issue, content, canonicalFolders, memoryContext);
  }

  const config = loadConfig();
  const tidyModel = (config.tidy && config.tidy.aiModel) || 'llama3.1:8b';
  const raw = await chat(prompt, '', { model: tidyModel, format: 'json', temperature: 0.2 });

  return parseAIResponse(raw);
}

// ────────────────────────────────────────────────────────────────────────────
// Prompt builders
// ────────────────────────────────────────────────────────────────────────────

async function buildDivergedDuplicatePrompt(vault, issue, content, canonicalFolders) {
  // Read up to 2 related notes
  const relatedSnippets = [];
  for (const relPath of (issue.relatedPaths || []).slice(0, 2)) {
    try {
      const relNote = await vault.readNote(relPath);
      if (relNote) {
        relatedSnippets.push(
          `Path: ${relPath}\nContent (truncated):\n${(relNote.content || '').slice(0, 500)}`
        );
      }
    } catch (_) { /* skip */ }
  }

  return `You are a vault housekeeping assistant. Two notes share the same filename but have different content (they may have diverged).

NOTE UNDER REVIEW
Path: ${issue.path}
Content (truncated):
${content.slice(0, MAX_CONTENT_CHARS)}

RELATED NOTE(S):
${relatedSnippets.join('\n\n---\n\n') || '(could not be read)'}

Canonical vault folders: ${canonicalFolders.join(', ')}

DECISION:
- delete: This note is clearly redundant; the canonical copy is elsewhere
- keep: Both notes serve different purposes and both should stay
- merge: The notes should be combined (flag for manual merge)
- flag: Uncertain — needs manual review

Reply with ONLY valid JSON, no markdown, no explanation outside the JSON:
{
  "action": "delete|keep|merge|flag",
  "reasoning": "one sentence explanation",
  "targetPath": "path/to/canonical.md or null",
  "confidence": 0.0
}`;
}

function buildStructurePrompt(issue, content, canonicalFolders, memoryContext) {
  const filename = path.basename(issue.path);
  const memorySection = memoryContext
    ? `\nMEMORY CONTEXT (this note was referenced in session memory):\n${memoryContext}\n`
    : '';
  return `You are a vault housekeeping assistant. A note is outside the canonical folder structure.

NOTE UNDER REVIEW
Path: ${issue.path}
Issue: ${issue.reason}
Content (truncated):
${content.slice(0, MAX_CONTENT_CHARS)}
${memorySection}
Canonical vault folders: ${canonicalFolders.join(', ')}

DECISION:
- move: Move the note to the correct canonical folder (you MUST provide targetPath)
- delete: The note is throwaway/test/empty — delete it
- keep: The note is correctly placed (or explain why it should stay at root)
- flag: Uncertain — needs manual review

If action is "move", targetPath should be the full path including filename:
  e.g. "Projects/project-name/${filename}" or "inbox/${filename}"

Reply with ONLY valid JSON:
{
  "action": "move|delete|keep|flag",
  "reasoning": "one sentence explanation",
  "targetPath": "canonical/folder/filename.md or null",
  "confidence": 0.0
}`;
}

function buildStubPrompt(issue, content, wordCount, canonicalFolders, memoryContext) {
  const memorySection = memoryContext
    ? `\nMEMORY CONTEXT (this note was referenced in session memory):\n${memoryContext}\n`
    : '';

  return `You are a vault housekeeping assistant. A note may be an abandoned draft or stub.

NOTE UNDER REVIEW
Path: ${issue.path}
Issue: ${issue.reason}
Word count: approximately ${wordCount}
Content:
${content.slice(0, MAX_CONTENT_CHARS)}
${memorySection}
IMPORTANT: If the note appears in memory context above, it was intentionally created and discussed — lean strongly toward "keep" or "flag", not "delete".

DECISION:
- delete: Note is empty, contains only test content, or has been abandoned with no value
- keep: Note is a complete atomic note / has genuine reference value
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

function buildGenericPrompt(issue, content, canonicalFolders) {
  return `You are a vault housekeeping assistant reviewing a note.

NOTE UNDER REVIEW
Path: ${issue.path}
Issue type: ${issue.type} (${issue.subtype || ''})
Issue: ${issue.reason}

Content (truncated):
${content.slice(0, MAX_CONTENT_CHARS)}

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

// ────────────────────────────────────────────────────────────────────────────
// Response parsing
// ────────────────────────────────────────────────────────────────────────────

/**
 * Parse the raw AI response into a structured decision object.
 * Always returns a valid object — never throws.
 */
function parseAIResponse(raw) {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { action: 'flag', reasoning: 'Could not parse AI response', targetPath: null, confidence: 0 };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const validActions = ['delete', 'move', 'merge', 'keep', 'flag'];
    const action = validActions.includes(parsed.action) ? parsed.action : 'flag';

    // Validate targetPath for move actions
    let targetPath = parsed.targetPath || null;
    if (action === 'move' && !targetPath) {
      // AI said move but gave no target — flag instead
      return {
        action: 'flag',
        reasoning: `AI suggested move but provided no target path. Original: ${parsed.reasoning || ''}`,
        targetPath: null,
        confidence: 0
      };
    }

    const confidence = typeof parsed.confidence === 'number'
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0.5;

    return {
      action,
      reasoning: String(parsed.reasoning || '').slice(0, 300),
      targetPath,
      confidence
    };
  } catch (err) {
    return { action: 'flag', reasoning: `JSON parse error: ${err.message}`, targetPath: null, confidence: 0 };
  }
}

module.exports = {
  triageIssues,
  triageIssue,
  parseAIResponse,
  AI_ACT_THRESHOLD
};
