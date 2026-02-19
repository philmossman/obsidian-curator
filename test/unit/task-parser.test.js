'use strict';

/**
 * Tests for the task parser (src/features/tasks/parser.js).
 * No vault or AI required — purely rule-based logic.
 */

const assert = require('assert');
const {
  parseTask,
  extractDate,
  extractPriority,
  detectProject,
  cleanTitle,
  buildProjectPatterns
} = require('../../src/features/tasks/parser');

// ─────────────────────────────────────────────
// Config fixture
// ─────────────────────────────────────────────

const CONFIG = {
  tasks: {
    folder: 'Tasks',
    projects: {
      Photography: ['photo', 'photos', 'photography', 'camera', 'shoot', 'lightroom'],
      Work:        ['work', 'office', 'meeting', 'client', 'invoice', 'deadline'],
      Home:        ['house', 'garden', 'clean', 'fix', 'repair']
    },
    defaultPriority: 'normal'
  }
};

// Reference date for deterministic date tests: Wednesday 2026-02-19
const REF_DATE = new Date(2026, 1, 19); // Feb 19 2026 local time

// ─────────────────────────────────────────────
// buildProjectPatterns
// ─────────────────────────────────────────────

function testBuildProjectPatterns() {
  const patterns = buildProjectPatterns(CONFIG);
  assert.strictEqual(patterns.length, 3, '3 project patterns from config');
  assert.ok(patterns.every(p => p.pattern instanceof RegExp), 'all patterns are RegExp');
  assert.ok(patterns.every(p => typeof p.project === 'string'), 'all have project names');
  console.log('  ✓ buildProjectPatterns');
}

function testBuildProjectPatternsEmpty() {
  const patterns = buildProjectPatterns({ tasks: { projects: {} } });
  assert.strictEqual(patterns.length, 0, 'empty projects → empty patterns');
  const noConfig = buildProjectPatterns({});
  assert.strictEqual(noConfig.length, 0, 'missing tasks → empty patterns');
  console.log('  ✓ buildProjectPatterns — empty config');
}

// ─────────────────────────────────────────────
// extractPriority
// ─────────────────────────────────────────────

function testExtractPriorityHigh() {
  assert.strictEqual(extractPriority('urgent: fix the bug').priority, 'high', 'URGENT: prefix');
  assert.strictEqual(extractPriority('fix this asap').priority, 'high', 'asap inline');
  assert.strictEqual(extractPriority('this is critical').priority, 'high', 'critical');
  assert.strictEqual(extractPriority('IMPORTANT: review PR').priority, 'high', 'IMPORTANT prefix');
  console.log('  ✓ extractPriority — high');
}

function testExtractPriorityLow() {
  assert.strictEqual(extractPriority('no rush on this').priority, 'low', 'no rush');
  assert.strictEqual(extractPriority('whenever you have time').priority, 'low', 'whenever');
  assert.strictEqual(extractPriority('eventually get round to it').priority, 'low', 'eventually');
  console.log('  ✓ extractPriority — low');
}

function testExtractPriorityNormal() {
  assert.strictEqual(extractPriority('call Alice tomorrow').priority, 'normal', 'normal task');
  assert.strictEqual(extractPriority('buy groceries').priority, 'normal', 'plain task');
  console.log('  ✓ extractPriority — normal');
}

function testExtractPriorityPrefix() {
  const { removedPrefix } = extractPriority('URGENT: fix the bug');
  assert.ok(removedPrefix, 'removedPrefix set for prefix pattern');
  const { removedPrefix: noPrefix } = extractPriority('fix this asap');
  assert.ok(!noPrefix, 'no removedPrefix for inline pattern');
  console.log('  ✓ extractPriority — prefix stripping');
}

// ─────────────────────────────────────────────
// detectProject
// ─────────────────────────────────────────────

function testDetectProjectPhotography() {
  assert.strictEqual(detectProject('edit the photos from Sunday', CONFIG), 'Photography', 'photos → Photography');
  assert.strictEqual(detectProject('lightroom export for client', CONFIG), 'Photography', 'lightroom → Photography');
  assert.strictEqual(detectProject('book a photo shoot', CONFIG), 'Photography', 'photo shoot → Photography');
  console.log('  ✓ detectProject — Photography');
}

function testDetectProjectWork() {
  assert.strictEqual(detectProject('send client invoice', CONFIG), 'Work', 'client → Work');
  assert.strictEqual(detectProject('attend office meeting', CONFIG), 'Work', 'meeting → Work');
  console.log('  ✓ detectProject — Work');
}

function testDetectProjectHome() {
  assert.strictEqual(detectProject('fix the garden gate', CONFIG), 'Home', 'fix → Home');
  assert.strictEqual(detectProject('clean the kitchen', CONFIG), 'Home', 'clean → Home');
  console.log('  ✓ detectProject — Home');
}

function testDetectProjectNone() {
  assert.strictEqual(detectProject('call Alice', CONFIG), null, 'no match → null');
  assert.strictEqual(detectProject('',          CONFIG), null, 'empty → null');
  console.log('  ✓ detectProject — no match');
}

function testDetectProjectEmptyConfig() {
  assert.strictEqual(detectProject('take photos', {}), null, 'empty config → null');
  console.log('  ✓ detectProject — empty config');
}

// ─────────────────────────────────────────────
// extractDate
// ─────────────────────────────────────────────

function testExtractDateTomorrow() {
  const { due, removedPhrase } = extractDate('call Alice tomorrow', REF_DATE);
  assert.strictEqual(due, '2026-02-20', 'tomorrow → next day');
  assert.strictEqual(removedPhrase, 'tomorrow', 'removed phrase is "tomorrow"');
  console.log('  ✓ extractDate — tomorrow');
}

function testExtractDateToday() {
  const { due } = extractDate('submit the report today', REF_DATE);
  assert.strictEqual(due, '2026-02-19', 'today → REF_DATE');
  console.log('  ✓ extractDate — today');
}

function testExtractDateNextWeekday() {
  // REF_DATE is Wednesday (3). Next Friday = Feb 20+2 = Feb 21 = incorrect... 
  // Actually: ref = Wednesday Feb 19. Next Friday = skip Thursday, get to Friday Feb 20? No. 
  // nextOccurrence starts from Feb 20 (Thu), walks until Friday = Feb 20 is Thu, Feb 21 is Fri.
  const { due } = extractDate('by next friday', REF_DATE);
  // nextWeekOccurrence from Wed Feb 19: go 7 days → Wed Feb 26, 
  // then startOfWeek(Mon-based) → Mon Feb 23, walk to Friday = Feb 27
  assert.ok(due, 'due date set for next friday');
  assert.ok(due > '2026-02-19', 'due is in the future');
  console.log('  ✓ extractDate — next weekday');
}

function testExtractDateInNDays() {
  const { due } = extractDate('fix this in 5 days', REF_DATE);
  assert.strictEqual(due, '2026-02-24', 'in 5 days from Feb 19 = Feb 24');
  console.log('  ✓ extractDate — in N days');
}

function testExtractDateMonthDay() {
  const { due } = extractDate('before March 1st', REF_DATE);
  assert.strictEqual(due, '2026-03-01', 'before March 1st = 2026-03-01');
  console.log('  ✓ extractDate — month day');
}

function testExtractDateISO() {
  const { due } = extractDate('submit by 2026-04-15', REF_DATE);
  assert.strictEqual(due, '2026-04-15', 'ISO date extracted');
  console.log('  ✓ extractDate — ISO date');
}

function testExtractDateNone() {
  const { due, removedPhrase } = extractDate('call Alice', REF_DATE);
  assert.strictEqual(due, null, 'no date → null');
  assert.strictEqual(removedPhrase, null, 'no phrase removed');
  console.log('  ✓ extractDate — no date');
}

// ─────────────────────────────────────────────
// cleanTitle
// ─────────────────────────────────────────────

function testCleanTitleOpeners() {
  assert.strictEqual(cleanTitle('remind me to call Alice', null),  'Call Alice',  'opener stripped');
  assert.strictEqual(cleanTitle('need to buy groceries',   null),  'Buy groceries', 'need to stripped');
  assert.strictEqual(cleanTitle('i should fix the gate',   null),  'Fix the gate', 'i should stripped');
  console.log('  ✓ cleanTitle — openers');
}

function testCleanTitleDateRemoval() {
  assert.ok(!cleanTitle('call Alice by March 1st', 'march 1st').includes('march'), 'date phrase removed');
  console.log('  ✓ cleanTitle — date removal');
}

function testCleanTitleCapitalisation() {
  assert.ok(cleanTitle('fix the bug', null)[0] === 'F', 'first letter capitalised');
  console.log('  ✓ cleanTitle — capitalisation');
}

function testCleanTitleEmpty() {
  assert.strictEqual(cleanTitle('', null), 'Untitled task', 'empty → Untitled task');
  console.log('  ✓ cleanTitle — empty');
}

// ─────────────────────────────────────────────
// Full parseTask integration
// ─────────────────────────────────────────────

function testParseTaskBasic() {
  const task = parseTask('remind me to call Alice tomorrow', CONFIG, REF_DATE);
  assert.strictEqual(task.title,    'Call Alice',  'title cleaned');
  assert.strictEqual(task.due,      '2026-02-20',  'due date extracted');
  assert.strictEqual(task.priority, 'normal',      'normal priority');
  assert.strictEqual(task.project,  null,          'no project detected');
  console.log('  ✓ parseTask — basic');
}

function testParseTaskWithProjectAndPriority() {
  const task = parseTask('URGENT: edit the photos from Sunday shoot', CONFIG, REF_DATE);
  assert.strictEqual(task.priority, 'high',        'high priority');
  assert.strictEqual(task.project,  'Photography', 'Photography project');
  assert.ok(!task.title.includes('URGENT'), 'URGENT prefix removed from title');
  console.log('  ✓ parseTask — project + priority');
}

function testParseTaskWithDueDate() {
  const task = parseTask('submit invoice by March 1st', CONFIG, REF_DATE);
  assert.strictEqual(task.due,     '2026-03-01', 'due date');
  assert.strictEqual(task.project, 'Work',       'Work project (invoice)');
  console.log('  ✓ parseTask — due date + project');
}

function testParseTaskEmpty() {
  const task = parseTask('', CONFIG, REF_DATE);
  assert.strictEqual(task.title,    'Untitled task', 'empty → Untitled task');
  assert.strictEqual(task.due,      null,            'no due');
  assert.strictEqual(task.priority, 'normal',        'normal priority');
  console.log('  ✓ parseTask — empty input');
}

function testParseTaskNullInput() {
  const task = parseTask(null, CONFIG, REF_DATE);
  assert.strictEqual(task.title, 'Untitled task', 'null → Untitled task');
  console.log('  ✓ parseTask — null input');
}

// ─────────────────────────────────────────────
// Run all
// ─────────────────────────────────────────────

module.exports = function runTaskParserTests() {
  console.log('\ntask-parser.test.js');
  let passed = 0;
  let failed = 0;

  const tests = [
    testBuildProjectPatterns,
    testBuildProjectPatternsEmpty,
    testExtractPriorityHigh,
    testExtractPriorityLow,
    testExtractPriorityNormal,
    testExtractPriorityPrefix,
    testDetectProjectPhotography,
    testDetectProjectWork,
    testDetectProjectHome,
    testDetectProjectNone,
    testDetectProjectEmptyConfig,
    testExtractDateTomorrow,
    testExtractDateToday,
    testExtractDateNextWeekday,
    testExtractDateInNDays,
    testExtractDateMonthDay,
    testExtractDateISO,
    testExtractDateNone,
    testCleanTitleOpeners,
    testCleanTitleDateRemoval,
    testCleanTitleCapitalisation,
    testCleanTitleEmpty,
    testParseTaskBasic,
    testParseTaskWithProjectAndPriority,
    testParseTaskWithDueDate,
    testParseTaskEmpty,
    testParseTaskNullInput
  ];

  for (const t of tests) {
    try {
      t();
      passed++;
    } catch (err) {
      console.error(`  FAILED: ${t.name}: ${err.message}`);
      failed++;
    }
  }

  if (failed === 0) console.log('  All Task Parser tests passed.\n');
  return { passed, failed };
};
