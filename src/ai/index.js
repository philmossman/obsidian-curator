'use strict';

/**
 * AI adapter factory.
 * Returns the right adapter instance based on config.ai.provider.
 */

const NoneAdapter = require('./none');
const OpenAIAdapter = require('./openai');
const AnthropicAdapter = require('./anthropic');
const OllamaAdapter = require('./ollama');

/**
 * Create an AI adapter based on the config.ai section.
 *
 * @param {Object} config - Full curator config (or just the ai sub-object)
 * @param {Object} [config.ai]
 * @param {string} [config.ai.provider='none'] - 'none' | 'openai' | 'anthropic' | 'ollama' | 'custom'
 * @param {string} [config.ai.model]
 * @param {string} [config.ai.apiKey]
 * @param {string} [config.ai.baseUrl]
 * @returns {import('./adapter')}
 */
function createAIAdapter(config) {
  // Accept either the full config or just the ai sub-section
  const ai = config.ai || config;
  const provider = (ai.provider || 'none').toLowerCase();

  switch (provider) {
    case 'none':
      return new NoneAdapter(ai);

    case 'openai':
      return new OpenAIAdapter(ai);

    case 'custom':
      // custom provider uses OpenAI-compatible API with a user-specified baseUrl
      return new OpenAIAdapter(ai);

    case 'anthropic':
      return new AnthropicAdapter(ai);

    case 'ollama':
      return new OllamaAdapter(ai);

    default:
      throw new Error(
        `Unknown AI provider: "${provider}". ` +
        'Supported: none, openai, anthropic, ollama, custom'
      );
  }
}

module.exports = createAIAdapter;
module.exports.createAIAdapter = createAIAdapter;
module.exports.NoneAdapter = NoneAdapter;
module.exports.OpenAIAdapter = OpenAIAdapter;
module.exports.AnthropicAdapter = AnthropicAdapter;
module.exports.OllamaAdapter = OllamaAdapter;
