'use strict';

/**
 * Test runner for obsidian-curator.
 * Runs all unit tests and reports totals.
 * No external test framework — uses Node's built-in assert.
 */

const runConfigTests = require('./unit/config.test');
const runAIAdapterTests = require('./unit/ai-adapters.test');
const runVaultClientTests = require('./unit/vault-client.test');

async function main() {
  console.log('obsidian-curator unit tests');
  console.log('===========================');

  let totalPassed = 0;
  let totalFailed = 0;

  // Sync test suite
  const configResult = runConfigTests();
  totalPassed += configResult.passed;
  totalFailed += configResult.failed;

  // Async test suite
  const aiResult = await runAIAdapterTests();
  totalPassed += aiResult.passed;
  totalFailed += aiResult.failed;

  // Sync test suite
  const vaultResult = runVaultClientTests();
  totalPassed += vaultResult.passed;
  totalFailed += vaultResult.failed;

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
