/**
 * Task Parser - Natural language → structured task
 *
 * Converts free-form Telegram text into structured task objects.
 * Rule-based, no AI required. Uses date-fns for date math.
 *
 * Usage:
 *   const { parseTask } = require('./task-parser');
 *   const task = parseTask('remind me to chase the farrier next Tuesday');
 *   // → { title: 'Chase the farrier', due: '2026-02-24', project: null, priority: 'normal' }
 */

const { addDays, addWeeks, format, parse, isValid, startOfWeek, addMonths } = require('date-fns');

// ─── Constants ────────────────────────────────────────────────────────────────

const WEEKDAYS = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6
};

const MONTHS = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12
};

const MONTH_NAMES = Object.keys(MONTHS).filter(k => k.length > 3)
  .concat(Object.keys(MONTHS).filter(k => k.length === 3));

/** Priority keyword mappings */
const PRIORITY_HIGH = /\b(urgent|urgently|asap|immediately|critical|emergency|important)\b/i;
const PRIORITY_HIGH_PREFIX = /^(urgent|important|asap)\s*[:!-]\s*/i;
const PRIORITY_LOW = /\b(low[- ]priority|when I have time|eventually|no rush|whenever)\b/i;

/** Project keyword mappings (keyword → project name) */
const PROJECT_KEYWORDS = [
  { pattern: /\b(photography|photos?|camera|shoot|shoots|darkroom|lightroom|lr|photoshoot)\b/i, project: 'Photography' },
  { pattern: /\b(crypto|bitcoin|btc|ethereum|eth|defi|nft|blockchain|wallet|staking)\b/i, project: 'Crypto' },
  { pattern: /\b(equestrian|horse|horses|farrier|vet|stable|stables|riding|pony|foal|mare|gelding|hack)\b/i, project: 'Equestrian' },
  { pattern: /\b(work|office|meeting|client|invoice|deadline|project|colleague)\b/i, project: 'Work' }
];

/** Opener phrases to strip from the beginning */
const OPENER_PATTERNS = [
  /^(?:can you )?remind me to\s+/i,
  /^(?:please )?remind me\s+to\s+/i,
  /^(?:don'?t forget to\s+)/i,
  /^remember to\s+/i,
  /^(?:i )?need to\s+/i,
  /^(?:i )?have to\s+/i,
  /^(?:i )?want to\s+/i,
  /^(?:i )?should\s+/i,
  /^(?:i )?must\s+/i,
  /^(?:please )?make sure (?:to\s+)?/i,
  /^(?:i )?(?:need|want) (?:you )?to\s+/i,
  /^task:\s*/i,
  /^todo:\s*/i,
];

// ─── Date Helpers ─────────────────────────────────────────────────────────────

/**
 * Get the next occurrence of a weekday, at least 1 day in the future.
 * @param {Date} from - Reference date
 * @param {number} targetDay - 0=Sunday ... 6=Saturday
 * @returns {Date}
 */
function nextOccurrence(from, targetDay) {
  let d = addDays(from, 1);
  while (d.getDay() !== targetDay) {
    d = addDays(d, 1);
  }
  return d;
}

/**
 * Get the occurrence of a weekday during the *following* week (7-13 days away).
 * "Next Tuesday" when today is Tuesday = 7 days from now.
 * @param {Date} from - Reference date
 * @param {number} targetDay - 0=Sunday ... 6=Saturday
 * @returns {Date}
 */
function nextWeekOccurrence(from, targetDay) {
  // Start from 7 days out, then find the target day
  let d = addDays(from, 7);
  // Walk back to start of that week, then forward to target day
  const weekStart = startOfWeek(d, { weekStartsOn: 1 }); // Monday-based weeks
  d = weekStart;
  while (d.getDay() !== targetDay) {
    d = addDays(d, 1);
  }
  return d;
}

/**
 * Parse a month name + day into a Date, choosing the nearest future year.
 * @param {number} month - 1-12
 * @param {number} day - 1-31
 * @param {Date} from - Reference date
 * @returns {Date|null}
 */
function parseMonthDay(month, day, from) {
  const year = from.getFullYear();
  let d = new Date(year, month - 1, day);
  if (!isValid(d)) return null;
  // If the date has already passed this year, use next year
  if (d < from) {
    d = new Date(year + 1, month - 1, day);
  }
  return d;
}

/**
 * Format a Date as YYYY-MM-DD string.
 * @param {Date} d
 * @returns {string}
 */
function toISODate(d) {
  return format(d, 'yyyy-MM-dd');
}

// ─── Date Phrase Extraction ───────────────────────────────────────────────────

/**
 * Date extraction rules. Each rule has a regex and a parser function.
 * Rules are tried in order; first match wins.
 * Returns { due: string, consumedText: string } where consumedText is the
 * matched portion to remove from the title.
 *
 * @param {string} text - Input text (already lowercased for matching)
 * @param {Date} now - Reference date
 * @returns {{ due: string|null, removedPhrase: string|null }}
 */
function extractDate(text, now) {
  const lower = text.toLowerCase();

  // ── Explicit ISO date ──────────────────────────────────────────────────────
  let m = lower.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (m) {
    const d = new Date(m[1]);
    if (isValid(d)) return { due: m[1], removedPhrase: m[0] };
  }

  // ── "by/before/on" + [month] [day][ordinal] ───────────────────────────────
  const monthList = MONTH_NAMES.join('|');
  const byMonthDay = new RegExp(
    `\\b(?:by|before|on)\\s+(${monthList})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i'
  );
  m = lower.match(byMonthDay);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    const day = parseInt(m[2], 10);
    const d = parseMonthDay(month, day, now);
    if (d) return { due: toISODate(d), removedPhrase: m[0] };
  }

  // ── "by/before/on" + [day][ordinal] + [month] ────────────────────────────
  const byDayMonth = new RegExp(
    `\\b(?:by|before|on)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthList})\\b`, 'i'
  );
  m = lower.match(byDayMonth);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = MONTHS[m[2].toLowerCase()];
    const d = parseMonthDay(month, day, now);
    if (d) return { due: toISODate(d), removedPhrase: m[0] };
  }

  // ── [month] [day][ordinal] standalone ─────────────────────────────────────
  const monthDayAlone = new RegExp(
    `\\b(${monthList})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i'
  );
  m = lower.match(monthDayAlone);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    const day = parseInt(m[2], 10);
    const d = parseMonthDay(month, day, now);
    if (d) return { due: toISODate(d), removedPhrase: m[0] };
  }

  // ── [day][ordinal] + [month] standalone ───────────────────────────────────
  const dayMonthAlone = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthList})\\b`, 'i'
  );
  m = lower.match(dayMonthAlone);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = MONTHS[m[2].toLowerCase()];
    const d = parseMonthDay(month, day, now);
    if (d) return { due: toISODate(d), removedPhrase: m[0] };
  }

  // ── "next [weekday]" ──────────────────────────────────────────────────────
  const weekdayList = Object.keys(WEEKDAYS).filter(k => k.length > 3).join('|');
  const weekdayShortList = Object.keys(WEEKDAYS).filter(k => k.length <= 3).join('|');
  const allWeekdays = weekdayList + '|' + weekdayShortList;

  m = lower.match(new RegExp(`\\b(?:by |before )?next\\s+(${allWeekdays})\\b`, 'i'));
  if (m) {
    const day = WEEKDAYS[m[1].toLowerCase()];
    if (day !== undefined) {
      const d = nextWeekOccurrence(now, day);
      return { due: toISODate(d), removedPhrase: m[0] };
    }
  }

  // ── "this [weekday]" ──────────────────────────────────────────────────────
  m = lower.match(new RegExp(`\\bthis\\s+(${allWeekdays})\\b`, 'i'));
  if (m) {
    const day = WEEKDAYS[m[1].toLowerCase()];
    if (day !== undefined) {
      // "this Friday" = the Friday of the current week (could be in the past)
      // We'll use next occurrence if it's past, to be safe
      const d = nextOccurrence(now, day);
      return { due: toISODate(d), removedPhrase: m[0] };
    }
  }

  // ── "by/before [weekday]" ─────────────────────────────────────────────────
  m = lower.match(new RegExp(`\\b(?:by|before)\\s+(${allWeekdays})\\b`, 'i'));
  if (m) {
    const day = WEEKDAYS[m[1].toLowerCase()];
    if (day !== undefined) {
      const d = nextOccurrence(now, day);
      return { due: toISODate(d), removedPhrase: m[0] };
    }
  }

  // ── "[weekday]" standalone ────────────────────────────────────────────────
  m = lower.match(new RegExp(`\\b(${allWeekdays})\\b`, 'i'));
  if (m) {
    const day = WEEKDAYS[m[1].toLowerCase()];
    if (day !== undefined) {
      const d = nextOccurrence(now, day);
      return { due: toISODate(d), removedPhrase: m[0] };
    }
  }

  // ── "tomorrow" ────────────────────────────────────────────────────────────
  if (/\btomorrow\b/i.test(lower)) {
    return { due: toISODate(addDays(now, 1)), removedPhrase: 'tomorrow' };
  }

  // ── "today" ───────────────────────────────────────────────────────────────
  if (/\btoday\b/i.test(lower)) {
    return { due: toISODate(now), removedPhrase: 'today' };
  }

  // ── "next week" ───────────────────────────────────────────────────────────
  if (/\bnext\s+week\b/i.test(lower)) {
    return { due: toISODate(addWeeks(now, 1)), removedPhrase: lower.match(/next\s+week/i)[0] };
  }

  // ── "next month" ─────────────────────────────────────────────────────────
  if (/\bnext\s+month\b/i.test(lower)) {
    return { due: toISODate(addMonths(now, 1)), removedPhrase: lower.match(/next\s+month/i)[0] };
  }

  // ── "in N days" ───────────────────────────────────────────────────────────
  m = lower.match(/\bin\s+(\d+)\s+days?\b/i);
  if (m) {
    return { due: toISODate(addDays(now, parseInt(m[1], 10))), removedPhrase: m[0] };
  }

  // ── "in N weeks" ─────────────────────────────────────────────────────────
  m = lower.match(/\bin\s+(\d+)\s+weeks?\b/i);
  if (m) {
    return { due: toISODate(addWeeks(now, parseInt(m[1], 10))), removedPhrase: m[0] };
  }

  // ── "this weekend" ────────────────────────────────────────────────────────
  if (/\bthis\s+weekend\b/i.test(lower)) {
    const d = nextOccurrence(now, 6); // Saturday
    return { due: toISODate(d), removedPhrase: lower.match(/this\s+weekend/i)[0] };
  }

  // ── "end of (the) month" ─────────────────────────────────────────────────
  if (/\bend\s+of\s+(?:the\s+)?month\b/i.test(lower)) {
    const eom = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { due: toISODate(eom), removedPhrase: lower.match(/end\s+of\s+(?:the\s+)?month/i)[0] };
  }

  return { due: null, removedPhrase: null };
}

// ─── Priority Extraction ─────────────────────────────────────────────────────

/**
 * Extract priority from text.
 * @param {string} text
 * @returns {{ priority: 'high'|'normal'|'low', removedPrefix: string|null }}
 */
function extractPriority(text) {
  // Check for explicit prefix first (e.g. "URGENT: ...")
  const prefixMatch = text.match(PRIORITY_HIGH_PREFIX);
  if (prefixMatch) {
    return { priority: 'high', removedPrefix: prefixMatch[0] };
  }

  if (PRIORITY_HIGH.test(text)) {
    return { priority: 'high', removedPrefix: null };
  }

  if (PRIORITY_LOW.test(text)) {
    return { priority: 'low', removedPrefix: null };
  }

  return { priority: 'normal', removedPrefix: null };
}

// ─── Project Detection ────────────────────────────────────────────────────────

/**
 * Detect project from text keywords.
 * @param {string} text
 * @returns {string|null}
 */
function detectProject(text) {
  for (const { pattern, project } of PROJECT_KEYWORDS) {
    if (pattern.test(text)) return project;
  }
  return null;
}

// ─── Title Cleaning ───────────────────────────────────────────────────────────

/**
 * Clean the title by removing filler phrases and date/priority fragments.
 * @param {string} text - Raw input (after prefix removal)
 * @param {string|null} removedDatePhrase - The date phrase to remove
 * @returns {string}
 */
function cleanTitle(text, removedDatePhrase) {
  let title = text.trim();

  // Remove date phrase (case-insensitive)
  if (removedDatePhrase) {
    // Also remove prepositions that may precede it: "by/before/on/until/due"
    const escapedPhrase = removedDatePhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    title = title.replace(
      new RegExp(`\\s*\\b(?:by|before|on|until|due|for)\\s+${escapedPhrase}\\b`, 'gi'),
      ''
    );
    title = title.replace(new RegExp(`\\s*\\b${escapedPhrase}\\b`, 'gi'), '');
  }

  // Remove priority words that don't add meaning to the title
  // (only inline ones; prefix already stripped)
  title = title.replace(/\b(urgent(ly)?|asap|immediately|low[- ]priority|no rush)\b/gi, '');

  // Apply opener patterns
  for (const pattern of OPENER_PATTERNS) {
    title = title.replace(pattern, '');
  }

  // Clean up double spaces, trailing punctuation, etc.
  title = title
    .replace(/\s{2,}/g, ' ')
    .replace(/[,;]\s*$/, '')
    .replace(/\.$/, '')
    .trim();

  // Capitalize first letter
  if (title.length > 0) {
    title = title[0].toUpperCase() + title.slice(1);
  }

  return title || 'Untitled task';
}

// ─── Main Parser ──────────────────────────────────────────────────────────────

/**
 * Parse a natural language task description into a structured task object.
 *
 * @param {string} text - Raw task text from Telegram
 * @param {Date} [now] - Reference date (defaults to current time, useful for testing)
 * @returns {{ title: string, due: string|null, project: string|null, priority: 'high'|'normal'|'low' }}
 */
function parseTask(text, now = new Date()) {
  if (!text || typeof text !== 'string') {
    return { title: 'Untitled task', due: null, project: null, priority: 'normal' };
  }

  const raw = text.trim();

  // 1. Extract priority (may strip a prefix like "URGENT: ")
  const { priority, removedPrefix } = extractPriority(raw);
  let working = removedPrefix ? raw.slice(removedPrefix.length).trim() : raw;

  // 2. Extract date
  const { due, removedPhrase } = extractDate(working, now);

  // 3. Detect project (from the full remaining text, before date removal)
  const project = detectProject(working);

  // 4. Build clean title
  const title = cleanTitle(working, removedPhrase);

  return { title, due, project, priority };
}

module.exports = { parseTask, extractDate, extractPriority, detectProject, cleanTitle };
