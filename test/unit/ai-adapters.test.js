'use strict';

/**
 * Tests for AI adapter factory and adapters.
 * No API calls are made — tests cover interface compliance and factory logic.
 */

const assert = require('assert');
const AIAdapter = require('../../src/ai/adapter');
const NoneAdapter = require('../../src/ai/none');
const createAIAdapter = require('../../src/ai/index');
const { OpenAIAdapter, AnthropicAdapter, OllamaAdapter } = require('../../src/ai/index');

// ─────────────────────────────────────────────
// Base adapter
// ─────────────────────────────────────────────

function testBaseAdapterThrows() {
  const base = new AIAdapter({ model: 'test' });
  assert.ok(base instanceof AIAdapter, 'AIAdapter instantiates');
  assert.strictEqual(base.model, 'test', 'AIAdapter stores model');

  // complete() must throw (not implemented)
  base.complete('hello').then(() => {
    throw new Error('Should have thrown');
  }).catch(err => {
    assert.ok(err.message.includes('not implemented'), 'base complete throws not-implemented');
  });

  // structured() must throw (not implemented)
  base.structured('hello', {}).then(() => {
    throw new Error('Should have thrown');
  }).catch(err => {
    assert.ok(err.message.includes('not implemented'), 'base structured throws not-implemented');
  });

  console.log('  ✓ base adapter interface');
}

// ─────────────────────────────────────────────
// NoneAdapter
// ─────────────────────────────────────────────

async function testNoneAdapter() {
  const adapter = new NoneAdapter();
  assert.ok(adapter instanceof AIAdapter, 'NoneAdapter extends AIAdapter');

  const result1 = await adapter.complete('test prompt');
  assert.strictEqual(result1, null, 'NoneAdapter.complete returns null');

  const result2 = await adapter.structured('test', { type: 'object' });
  assert.strictEqual(result2, null, 'NoneAdapter.structured returns null');

  assert.strictEqual(adapter.model, null, 'NoneAdapter.model is null');

  console.log('  ✓ NoneAdapter');
}

// ─────────────────────────────────────────────
// _extractJson helper
// ─────────────────────────────────────────────

function testExtractJson() {
  const adapter = new NoneAdapter();

  // Object
  const obj = adapter._extractJson('Here is the result: {"foo": "bar", "n": 42}');
  assert.deepStrictEqual(obj, { foo: 'bar', n: 42 }, '_extractJson extracts object');

  // Array
  const arr = adapter._extractJson('Result: [1,2,3]');
  assert.deepStrictEqual(arr, [1, 2, 3], '_extractJson extracts array');

  // No JSON
  assert.throws(
    () => adapter._extractJson('no json here'),
    /No JSON/,
    '_extractJson throws when no JSON found'
  );

  console.log('  ✓ _extractJson');
}

// ─────────────────────────────────────────────
// createAIAdapter factory
// ─────────────────────────────────────────────

function testFactory() {
  // none provider
  const none = createAIAdapter({ ai: { provider: 'none' } });
  assert.ok(none instanceof NoneAdapter, 'factory: none → NoneAdapter');

  // ai object passed directly (no outer config wrapper)
  const none2 = createAIAdapter({ provider: 'none' });
  assert.ok(none2 instanceof NoneAdapter, 'factory: ai sub-object → NoneAdapter');

  // openai provider
  const openai = createAIAdapter({ ai: { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o-mini' } });
  assert.ok(openai instanceof OpenAIAdapter, 'factory: openai → OpenAIAdapter');
  assert.strictEqual(openai.model, 'gpt-4o-mini', 'factory: openai model set');

  // custom provider (uses OpenAI compat)
  const custom = createAIAdapter({ ai: { provider: 'custom', apiKey: 'sk-x', model: 'my-model', baseUrl: 'http://localhost:8000' } });
  assert.ok(custom instanceof OpenAIAdapter, 'factory: custom → OpenAIAdapter');

  // anthropic provider
  const anthropic = createAIAdapter({ ai: { provider: 'anthropic', apiKey: 'sk-ant-test', model: 'claude-haiku-4-5' } });
  assert.ok(anthropic instanceof AnthropicAdapter, 'factory: anthropic → AnthropicAdapter');

  // ollama provider
  const ollama = createAIAdapter({ ai: { provider: 'ollama', model: 'llama3' } });
  assert.ok(ollama instanceof OllamaAdapter, 'factory: ollama → OllamaAdapter');

  // unknown provider
  assert.throws(
    () => createAIAdapter({ ai: { provider: 'magic-gpt' } }),
    /Unknown AI provider/,
    'factory: unknown provider throws'
  );

  // default when provider missing
  const defaultNone = createAIAdapter({ ai: {} });
  assert.ok(defaultNone instanceof NoneAdapter, 'factory: missing provider defaults to none');

  console.log('  ✓ createAIAdapter factory');
}

// ─────────────────────────────────────────────
// Adapter construction validation
// ─────────────────────────────────────────────

function testAdapterConstruction() {
  // OpenAI requires apiKey
  assert.throws(
    () => new OpenAIAdapter({ model: 'gpt-4o' }),
    /apiKey/,
    'OpenAIAdapter: throws without apiKey'
  );

  // OpenAI default model and baseUrl
  const oa = new OpenAIAdapter({ apiKey: 'sk-test' });
  assert.strictEqual(oa.model, 'gpt-4o-mini', 'OpenAIAdapter: default model');
  assert.ok(oa.baseUrl.includes('openai.com'), 'OpenAIAdapter: default baseUrl');

  // Anthropic requires apiKey
  assert.throws(
    () => new AnthropicAdapter({ model: 'claude-haiku-4-5' }),
    /apiKey/,
    'AnthropicAdapter: throws without apiKey'
  );

  // Anthropic default model
  const aa = new AnthropicAdapter({ apiKey: 'sk-ant-test' });
  assert.strictEqual(aa.model, 'claude-haiku-4-5', 'AnthropicAdapter: default model');

  // Ollama requires model
  assert.throws(
    () => new OllamaAdapter({}),
    /model/,
    'OllamaAdapter: throws without model'
  );

  // Ollama default baseUrl
  const oa2 = new OllamaAdapter({ model: 'llama3' });
  assert.ok(oa2.baseUrl.includes('localhost'), 'OllamaAdapter: default baseUrl');

  console.log('  ✓ adapter construction validation');
}

// ─────────────────────────────────────────────
// Run all
// ─────────────────────────────────────────────

module.exports = async function runAIAdapterTests() {
  console.log('\nai-adapters.test.js');
  let passed = 0;
  let failed = 0;

  const run = async (fn) => {
    try {
      await fn();
      passed++;
    } catch (err) {
      console.error(`  FAILED: ${fn.name}:`, err.message);
      failed++;
    }
  };

  await run(testBaseAdapterThrows);
  await run(testNoneAdapter);
  await run(testExtractJson);
  await run(testFactory);
  await run(testAdapterConstruction);

  if (failed === 0) {
    console.log('  All AI adapter tests passed.\n');
  }
  return { passed, failed };
};
