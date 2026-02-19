'use strict';

/**
 * Task Parser — natural language → structured task object.
 *
 * Rule-based, no AI required. Extracts:
 *   - title: cleaned task description
 *   - due: ISO date string (YYYY-MM-DD) or null
 *   - project: matched from config.tasks.projects keywords, or null
 *   - priority: 'high' | 'normal' | 'low'
 *
 * Usage:
 *   const { parseTask } = require('./parser');
 *   const task = parseTask('remind me to call Alice next Tuesday', config);
 */

const { addDays, addWeeks, addMonths, format, isValid, startOfWeek } = require('date-fns');

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

const MONTH_NAMES = [
  ...Object.keys(MONTHS).filter(k => k.length > 3),
  ...Object.keys(MONTHS).filter(k => k.length === 3)
];

/** Priority keyword patterns */
const PRIORITY_HIGH         = /\b(urgent|urgently|asap|immediately|critical|emergency|important)\b/i;
const PRIORITY_HIGH_PREFIX  = /^(urgent|important|asap)\s*[:!-]\s*/i;
const PRIORITY_LOW          = /\b(low[- ]priority|when I have time|eventually|no rush|whenever)\b/i;

/** Opener phrases to strip from the beginning of task text */
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

// ─── Date helpers ─────────────────────────────────────────────────────────────

function nextOccurrence(from, targetDay) {
  let d = addDays(from, 1);
  while (d.getDay() !== targetDay) d = addDays(d, 1);
  return d;
}

function nextWeekOccurrence(from, targetDay) {
  let d = addDays(from, 7);
  const weekStart = startOfWeek(d, { weekStartsOn: 1 });
  d = weekStart;
  while (d.getDay() !== targetDay) d = addDays(d, 1);
  return d;
}

function parseMonthDay(month, day, from) {
  const year = from.getFullYear();
  let d = new Date(year, month - 1, day);
  if (!isValid(d)) return null;
  if (d < from) d = new Date(year + 1, month - 1, day);
  return d;
}

function toISODate(d) {
  return format(d, 'yyyy-MM-dd');
}

// ─── Date extraction ──────────────────────────────────────────────────────────

/**
 * Extract a due date from task text.
 * @param {string} text - Input text (lowercased for matching)
 * @param {Date} now    - Reference date
 * @returns {{ due: string|null, removedPhrase: string|null }}
 */
function extractDate(text, now) {
  const lower = text.toLowerCase();

  // Explicit ISO date
  let m = lower.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (m) {
    const d = new Date(m[1]);
    if (isValid(d)) return { due: m[1], removedPhrase: m[0] };
  }

  // "by/before/on" + month + day
  const monthList = MONTH_NAMES.join('|');
  let rx = new RegExp(`\\b(?:by|before|on)\\s+(${monthList})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i');
  m = lower.match(rx);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    const day   = parseInt(m[2], 10);
    const d     = parseMonthDay(month, day, now);
    if (d) return { due: toISODate(d), removedPhrase: m[0] };
  }

  // "by/before/on" + day + month
  rx = new RegExp(`\\b(?:by|before|on)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthList})\\b`, 'i');
  m  = lower.match(rx);
  if (m) {
    const day   = parseInt(m[1], 10);
    const month = MONTHS[m[2].toLowerCase()];
    const d     = parseMonthDay(month, day, now);
    if (d) return { due: toISODate(d), removedPhrase: m[0] };
  }

  // Month + day alone
  rx = new RegExp(`\\b(${monthList})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i');
  m  = lower.match(rx);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    const day   = parseInt(m[2], 10);
    const d     = parseMonthDay(month, day, now);
    if (d) return { due: toISODate(d), removedPhrase: m[0] };
  }

  // Day + month alone
  rx = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthList})\\b`, 'i');
  m  = lower.match(rx);
  if (m) {
    const day   = parseInt(m[1], 10);
    const month = MONTHS[m[2].toLowerCase()];
    const d     = parseMonthDay(month, day, now);
    if (d) return { due: toISODate(d), removedPhrase: m[0] };
  }

  // Weekday names (long and short)
  const weekdayList      = Object.keys(WEEKDAYS).filter(k => k.length > 3).join('|');
  const weekdayShortList = Object.keys(WEEKDAYS).filter(k => k.length <= 3).join('|');
  const allWeekdays      = weekdayList + '|' + weekdayShortList;

  // "next [weekday]"
  m = lower.match(new RegExp(`\\b(?:by |before )?next\\s+(${allWeekdays})\\b`, 'i'));
  if (m) {
    const day = WEEKDAYS[m[1].toLowerCase()];
    if (day !== undefined) return { due: toISODate(nextWeekOccurrence(now, day)), removedPhrase: m[0] };
  }

  // "this [weekday]"
  m = lower.match(new RegExp(`\\bthis\\s+(${allWeekdays})\\b`, 'i'));
  if (m) {
    const day = WEEKDAYS[m[1].toLowerCase()];
    if (day !== undefined) return { due: toISODate(nextOccurrence(now, day)), removedPhrase: m[0] };
  }

  // "by/before [weekday]"
  m = lower.match(new RegExp(`\\b(?:by|before)\\s+(${allWeekdays})\\b`, 'i'));
  if (m) {
    const day = WEEKDAYS[m[1].toLowerCase()];
    if (day !== undefined) return { due: toISODate(nextOccurrence(now, day)), removedPhrase: m[0] };
  }

  // Bare weekday
  m = lower.match(new RegExp(`\\b(${allWeekdays})\\b`, 'i'));
  if (m) {
    const day = WEEKDAYS[m[1].toLowerCase()];
    if (day !== undefined) return { due: toISODate(nextOccurrence(now, day)), removedPhrase: m[0] };
  }

  if (/\btomorrow\b/i.test(lower)) {
    return { due: toISODate(addDays(now, 1)), removedPhrase: 'tomorrow' };
  }

  if (/\btoday\b/i.test(lower)) {
    return { due: toISODate(now), removedPhrase: 'today' };
  }

  if (/\bnext\s+week\b/i.test(lower)) {
    return { due: toISODate(addWeeks(now, 1)), removedPhrase: lower.match(/next\s+week/i)[0] };
  }

  if (/\bnext\s+month\b/i.test(lower)) {
    return { due: toISODate(addMonths(now, 1)), removedPhrase: lower.match(/next\s+month/i)[0] };
  }

  m = lower.match(/\bin\s+(\d+)\s+days?\b/i);
  if (m) return { due: toISODate(addDays(now, parseInt(m[1], 10))), removedPhrase: m[0] };

  m = lower.match(/\bin\s+(\d+)\s+weeks?\b/i);
  if (m) return { due: toISODate(addWeeks(now, parseInt(m[1], 10))), removedPhrase: m[0] };

  if (/\bthis\s+weekend\b/i.test(lower)) {
    return { due: toISODate(nextOccurrence(now, 6)), removedPhrase: lower.match(/this\s+weekend/i)[0] };
  }

  if (/\bend\s+of\s+(?:the\s+)?month\b/i.test(lower)) {
    const eom = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { due: toISODate(eom), removedPhrase: lower.match(/end\s+of\s+(?:the\s+)?month/i)[0] };
  }

  return { due: null, removedPhrase: null };
}

// ─── Priority extraction ──────────────────────────────────────────────────────

/**
 * Extract priority from text.
 * @param {string} text
 * @returns {{ priority: 'high'|'normal'|'low', removedPrefix: string|null }}
 */
function extractPriority(text) {
  const prefixMatch = text.match(PRIORITY_HIGH_PREFIX);
  if (prefixMatch) return { priority: 'high', removedPrefix: prefixMatch[0] };
  if (PRIORITY_HIGH.test(text)) return { priority: 'high', removedPrefix: null };
  if (PRIORITY_LOW.test(text))  return { priority: 'low',  removedPrefix: null };
  return { priority: 'normal', removedPrefix: null };
}

// ─── Project detection ────────────────────────────────────────────────────────

/**
 * Build project patterns from config.tasks.projects.
 * config.tasks.projects = { "ProjectName": ["keyword1", "keyword2", ...] }
 *
 * @param {Object} config
 * @returns {Array<{ pattern: RegExp, project: string }>}
 */
function buildProjectPatterns(config) {
  const projects = (config && config.tasks && config.tasks.projects) || {};
  return Object.entries(projects).map(([project, keywords]) => {
    const escaped = keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return {
      pattern: new RegExp(`\\b(${escaped.join('|')})\\b`, 'i'),
      project
    };
  });
}

/**
 * Detect project from text using config-driven keyword patterns.
 *
 * @param {string} text
 * @param {Object} config
 * @returns {string|null}
 */
function detectProject(text, config) {
  const patterns = buildProjectPatterns(config);
  for (const { pattern, project } of patterns) {
    if (pattern.test(text)) return project;
  }
  return null;
}

// ─── Title cleaning ───────────────────────────────────────────────────────────

/**
 * Clean the title by removing filler phrases and date/priority fragments.
 *
 * @param {string}      text              - Raw input (after prefix removal)
 * @param {string|null} removedDatePhrase - The date phrase to remove
 * @returns {string}
 */
function cleanTitle(text, removedDatePhrase) {
  let title = text.trim();

  if (removedDatePhrase) {
    const escaped = removedDatePhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    title = title.replace(
      new RegExp(`\\s*\\b(?:by|before|on|until|due|for)\\s+${escaped}\\b`, 'gi'),
      ''
    );
    title = title.replace(new RegExp(`\\s*\\b${escaped}\\b`, 'gi'), '');
  }

  title = title.replace(/\b(urgent(ly)?|asap|immediately|low[- ]priority|no rush)\b/gi, '');

  for (const pattern of OPENER_PATTERNS) {
    title = title.replace(pattern, '');
  }

  title = title
    .replace(/\s{2,}/g, ' ')
    .replace(/[,;]\s*$/, '')
    .replace(/\.$/, '')
    .trim();

  if (title.length > 0) {
    title = title[0].toUpperCase() + title.slice(1);
  }

  return title || 'Untitled task';
}

// ─── Main parser ──────────────────────────────────────────────────────────────

/**
 * Parse a natural language task description into a structured task object.
 *
 * @param {string} text   - Raw task text
 * @param {Object} config - Loaded curator config (for project keywords)
 * @param {Date}  [now]   - Reference date (defaults to current time; useful for tests)
 * @returns {{ title: string, due: string|null, project: string|null, priority: 'high'|'normal'|'low' }}
 */
function parseTask(text, config, now = new Date()) {
  if (!text || typeof text !== 'string') {
    return { title: 'Untitled task', due: null, project: null, priority: 'normal' };
  }

  const raw = text.trim();

  // 1. Priority (may strip a prefix like "URGENT: ")
  const { priority, removedPrefix } = extractPriority(raw);
  let working = removedPrefix ? raw.slice(removedPrefix.length).trim() : raw;

  // 2. Date
  const { due, removedPhrase } = extractDate(working, now);

  // 3. Project (from full remaining text, before date removal)
  const project = detectProject(working, config);

  // 4. Clean title
  const title = cleanTitle(working, removedPhrase);

  return { title, due, project, priority };
}

module.exports = {
  parseTask,
  extractDate,
  extractPriority,
  detectProject,
  cleanTitle,
  buildProjectPatterns
};
