'use strict';

/**
 * Test runner for obsidian-curator.
 * Runs all unit tests and reports totals.
 * No external test framework — uses Node's built-in assert.
 */

const runConfigTests       = require('./unit/config.test');
const runAIAdapterTests    = require('./unit/ai-adapters.test');
const runVaultClientTests  = require('./unit/vault-client.test');
const runCLITests          = require('./unit/cli.test');
// Phase 3 tests
const runProcessorTests    = require('./unit/processor.test');
const runTidyScannerTests  = require('./unit/tidy-scanner.test');
const runTaskParserTests   = require('./unit/task-parser.test');
const runAuditorTests      = require('./unit/auditor.test');

async function main() {
  console.log('obsidian-curator unit tests');
  console.log('===========================');

  let totalPassed = 0;
  let totalFailed = 0;

  // Phase 1 & 2 tests (sync/async)
  const configResult = runConfigTests();
  totalPassed += configResult.passed;
  totalFailed += configResult.failed;

  const aiResult = await runAIAdapterTests();
  totalPassed += aiResult.passed;
  totalFailed += aiResult.failed;

  const vaultResult = runVaultClientTests();
  totalPassed += vaultResult.passed;
  totalFailed += vaultResult.failed;

  const cliResult = await runCLITests();
  totalPassed += cliResult.passed;
  totalFailed += cliResult.failed;

  // Phase 3 tests
  const processorResult = await runProcessorTests();
  totalPassed += processorResult.passed;
  totalFailed += processorResult.failed;

  const scannerResult = runTidyScannerTests();
  totalPassed += scannerResult.passed;
  totalFailed += scannerResult.failed;

  const taskParserResult = runTaskParserTests();
  totalPassed += taskParserResult.passed;
  totalFailed += taskParserResult.failed;

  const auditorResult = await runAuditorTests();
  totalPassed += auditorResult.passed;
  totalFailed += auditorResult.failed;

  console.log('===========================');
  console.log(`Total: ${totalPassed} passed, ${totalFailed} failed`);

  if (totalFailed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
