'use strict';

/**
 * Base AIAdapter interface.
 * All provider adapters must extend this class and implement
 * complete() and structured().
 */
class AIAdapter {
  /**
   * @param {Object} config - Provider-specific config
   * @param {string} [config.model] - Model identifier
   * @param {string} [config.apiKey]
   * @param {string} [config.baseUrl]
   */
  constructor(config = {}) {
    this.config = config;
    this.model = config.model || null;
  }

  /**
   * Send a prompt and return the text response.
   * @param {string} prompt
   * @param {Object} [options]
   * @param {number} [options.temperature=0.3]
   * @param {number} [options.maxTokens=2048]
   * @returns {Promise<string>}
   */
  async complete(prompt, options = {}) {
    throw new Error(`${this.constructor.name}.complete() is not implemented`);
  }

  /**
   * Send a prompt and parse the response as structured JSON matching schema.
   * Implementations should instruct the model to return valid JSON and
   * parse/validate the output.
   * @param {string} prompt
   * @param {Object} schema - JSON Schema describing the expected response shape
   * @param {Object} [options]
   * @param {number} [options.temperature=0.3]
   * @param {number} [options.maxTokens=2048]
   * @returns {Promise<Object>}
   */
  async structured(prompt, schema, options = {}) {
    throw new Error(`${this.constructor.name}.structured() is not implemented`);
  }

  /**
   * Extract JSON from a text response that may contain other content.
   * Tries to find the first {...} or [...] block.
   * @param {string} text
   * @returns {Object|Array}
   * @throws {Error} if no valid JSON found
   */
  _extractJson(text) {
    const match = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (!match) throw new Error('No JSON found in AI response');
    return JSON.parse(match[0]);
  }
}

module.exports = AIAdapter;
