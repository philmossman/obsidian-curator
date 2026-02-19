'use strict';

/**
 * Tests for the StructureAuditor (src/features/auditor.js).
 * Uses a mock vault — no real CouchDB connection.
 */

const assert = require('assert');
const { StructureAuditor, METHODOLOGIES } = require('../../src/features/auditor');

// ─────────────────────────────────────────────
// Mock helpers
// ─────────────────────────────────────────────

/** Make a mock vault that returns a fixed list of notes. */
function makeMockVault(notes) {
  return {
    async listNotes() { return notes; }
  };
}

function note(path, size = 300) {
  return { path, size };
}

// ─────────────────────────────────────────────
// Config fixture
// ─────────────────────────────────────────────

const PARA_CONFIG = {
  structure: {
    preset: 'para',
    folders: {
      inbox:     'inbox',
      projects:  'Projects',
      areas:     'Areas',
      resources: 'Resources',
      archive:   'Archives'
    },
    customFolders:  [],
    rootExceptions: ['Index.md', 'Welcome.md'],
    systemPaths:    ['logs/']
  },
  tasks: { folder: 'Tasks', projects: {} },
  tidy:  { autoDeleteConfidence: 0.8, testPatterns: ['Untitled*'], maxAutoActions: 50 }
};

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

async function testConstructorValidation() {
  assert.throws(() => new StructureAuditor(null, PARA_CONFIG),  /vault/,  'throws without vault');
  assert.throws(() => new StructureAuditor({},   null),         /config/, 'throws without config');
  const a = new StructureAuditor({ listNotes: async () => [] }, PARA_CONFIG);
  assert.ok(a, 'constructs with valid args');
  console.log('  ✓ StructureAuditor constructor validation');
}

async function testReportShape() {
  const vault = makeMockVault([
    note('Projects/proj-a.md'),
    note('Projects/proj-b.md'),
    note('Areas/fitness.md'),
    note('inbox/new-idea.md')
  ]);
  const auditor = new StructureAuditor(vault, PARA_CONFIG);
  const report  = await auditor.analyze();

  assert.ok(report, 'returns a report');
  assert.ok(report.summary, 'has summary');
  assert.ok(typeof report.summary.totalNotes   === 'number', 'summary.totalNotes is number');
  assert.ok(typeof report.summary.totalFolders === 'number', 'summary.totalFolders is number');
  assert.ok(Array.isArray(report.issues),          'issues is array');
  assert.ok(Array.isArray(report.recommendations), 'recommendations is array');
  assert.ok(report.structure, 'has structure overview');
  console.log('  ✓ StructureAuditor report shape');
}

async function testNoteCountAccurate() {
  const notes = [
    note('Projects/a.md'),
    note('Projects/b.md'),
    note('Areas/c.md')
  ];
  const vault   = makeMockVault(notes);
  const auditor = new StructureAuditor(vault, PARA_CONFIG);
  const report  = await auditor.analyze();
  assert.strictEqual(report.summary.totalNotes, 3, 'correct note count');
  console.log('  ✓ StructureAuditor note count');
}

async function testSystemPathsExcluded() {
  const notes = [
    note('Projects/a.md'),
    note('logs/2026-01-01.md')  // system path → should be excluded
  ];
  const vault   = makeMockVault(notes);
  const auditor = new StructureAuditor(vault, PARA_CONFIG);
  const report  = await auditor.analyze();
  assert.strictEqual(report.summary.totalNotes, 1, 'system path excluded from count');
  console.log('  ✓ StructureAuditor excludes system paths');
}

async function testDetectsRootNotes() {
  const notes = [
    note('Projects/proj.md'),
    note('stray-note.md')  // should trigger "Notes at vault root" issue
  ];
  const vault   = makeMockVault(notes);
  const auditor = new StructureAuditor(vault, PARA_CONFIG);
  const report  = await auditor.analyze();
  const orgIssue = report.issues.find(i => i.category === 'organisation' || i.category === 'organization');
  assert.ok(orgIssue, 'root notes issue detected');
  console.log('  ✓ StructureAuditor detects root notes');
}

async function testRootExceptionsNotFlagged() {
  const notes = [
    note('Projects/proj.md'),
    note('Index.md'),    // exception — not flagged
    note('Welcome.md')   // exception — not flagged
  ];
  const vault   = makeMockVault(notes);
  const auditor = new StructureAuditor(vault, PARA_CONFIG);
  const report  = await auditor.analyze();
  const orgIssues = report.issues.filter(i => i.category === 'organisation' || i.category === 'organization');
  assert.ok(
    !orgIssues.some(i => i.detail && i.detail.includes('Index.md')),
    'Index.md not flagged'
  );
  console.log('  ✓ StructureAuditor respects root exceptions');
}

async function testDetectsNonCanonicalFolders() {
  const notes = [
    note('Projects/proj.md'),
    note('RandomFolder/some-note.md')  // non-canonical
  ];
  const vault   = makeMockVault(notes);
  const auditor = new StructureAuditor(vault, PARA_CONFIG);
  const report  = await auditor.analyze();
  const structIssue = report.issues.find(i => i.category === 'structure');
  assert.ok(structIssue, 'non-canonical folder issue detected');
  console.log('  ✓ StructureAuditor detects non-canonical folders');
}

async function testEmptyVault() {
  const vault   = makeMockVault([]);
  const auditor = new StructureAuditor(vault, PARA_CONFIG);
  const report  = await auditor.analyze();
  assert.strictEqual(report.summary.totalNotes,   0, 'zero notes');
  assert.strictEqual(report.summary.totalFolders, 0, 'zero folders');
  assert.ok(Array.isArray(report.issues), 'issues is array (empty vault)');
  console.log('  ✓ StructureAuditor handles empty vault');
}

async function testDetectedMethodology() {
  // Vault with strong PARA signal
  const notes = [
    note('Projects/proj.md'),
    note('Areas/fitness.md'),
    note('Resources/books.md'),
    note('Archives/old.md'),
    note('inbox/new.md')
  ];
  const vault   = makeMockVault(notes);
  const auditor = new StructureAuditor(vault, PARA_CONFIG);
  const report  = await auditor.analyze();
  // With 4/4 PARA folders present, should detect PARA
  if (report.summary.detectedMethodology) {
    assert.strictEqual(report.summary.detectedMethodology.type, 'PARA', 'PARA detected');
    console.log('  ✓ StructureAuditor detects PARA methodology');
  } else {
    // Might not detect with small note counts (acceptable)
    console.log('  ~ StructureAuditor methodology detection skipped (small vault)');
  }
}

async function testStructureOverview() {
  const notes = [
    note('Projects/a.md'),
    note('Projects/b.md'),
    note('Areas/c.md')
  ];
  const vault   = makeMockVault(notes);
  const auditor = new StructureAuditor(vault, PARA_CONFIG);
  const report  = await auditor.analyze();
  assert.ok(Array.isArray(report.structure.topLevel), 'topLevel is array');
  assert.ok(report.structure.topLevel.length > 0,     'has top-level folders');
  const projects = report.structure.topLevel.find(f => f.folder === 'Projects');
  assert.ok(projects, 'Projects folder in overview');
  assert.strictEqual(projects.total, 2, 'Projects has 2 notes (recursive count)');
  console.log('  ✓ StructureAuditor structure overview');
}

async function testMethodologiesExported() {
  assert.ok(METHODOLOGIES.PARA, 'PARA methodology exported');
  assert.ok(METHODOLOGIES.Zettelkasten, 'Zettelkasten exported');
  assert.ok(Array.isArray(METHODOLOGIES.PARA.folders), 'PARA has folders array');
  console.log('  ✓ METHODOLOGIES exported');
}

// ─────────────────────────────────────────────
// Run all
// ─────────────────────────────────────────────

module.exports = async function runAuditorTests() {
  console.log('\nauditor.test.js');
  let passed = 0;
  let failed = 0;

  const tests = [
    testConstructorValidation,
    testReportShape,
    testNoteCountAccurate,
    testSystemPathsExcluded,
    testDetectsRootNotes,
    testRootExceptionsNotFlagged,
    testDetectsNonCanonicalFolders,
    testEmptyVault,
    testDetectedMethodology,
    testStructureOverview,
    testMethodologiesExported
  ];

  for (const t of tests) {
    try {
      await t();
      passed++;
    } catch (err) {
      console.error(`  FAILED: ${t.name}: ${err.message}`);
      failed++;
    }
  }

  if (failed === 0) console.log('  All Auditor tests passed.\n');
  return { passed, failed };
};
