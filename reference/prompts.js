/**
 * prompts.js — Shared AI prompt templates for vault-curator
 *
 * Single source of truth for prompts used across multiple modules.
 * Import the function you need rather than duplicating prompt text.
 */

/**
 * Build the memory extraction prompt for distillation.
 * Used by distiller.js and distill-orchestrator.js.
 *
 * @param {Array} memoryFiles - Array of { date, content } objects
 * @returns {string} Formatted prompt string
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
      "topic": "project or subject area (e.g., vault-curator, security, crypto-trading)",
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
  buildExtractionPrompt
};
