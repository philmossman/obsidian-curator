'use strict';

/**
 * Anthropic adapter.
 * Uses the Anthropic Messages API via fetch. No SDK dependency.
 */

const AIAdapter = require('./adapter');

const DEFAULT_MODEL = 'claude-haiku-4-5';
const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';

class AnthropicAdapter extends AIAdapter {
  /**
   * @param {Object} config
   * @param {string} config.apiKey - Anthropic API key
   * @param {string} [config.model='claude-haiku-4-5']
   * @param {string} [config.baseUrl='https://api.anthropic.com/v1']
   */
  constructor(config = {}) {
    super(config);
    if (!config.apiKey) throw new Error('Anthropic adapter requires config.ai.apiKey');
    this.apiKey = config.apiKey;
    this.model = config.model || DEFAULT_MODEL;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  /**
   * @param {string} prompt
   * @param {Object} [options]
   * @param {number} [options.temperature=0.3]
   * @param {number} [options.maxTokens=2048]
   * @returns {Promise<string>}
   */
  async complete(prompt, options = {}) {
    const { temperature = 0.3, maxTokens = 2048 } = options;
    const data = await this._messagesRequest([
      { role: 'user', content: prompt }
    ], { temperature, max_tokens: maxTokens });
    return data.content[0].text;
  }

  /**
   * @param {string} prompt
   * @param {Object} schema - JSON schema for expected response
   * @param {Object} [options]
   * @param {number} [options.temperature=0.1]
   * @param {number} [options.maxTokens=2048]
   * @returns {Promise<Object>}
   */
  async structured(prompt, schema, options = {}) {
    const { temperature = 0.1, maxTokens = 2048 } = options;
    const jsonPrompt = `${prompt}\n\nRespond with ONLY valid JSON matching this schema:\n${JSON.stringify(schema, null, 2)}\n\nJSON:`;
    const data = await this._messagesRequest([
      { role: 'user', content: jsonPrompt }
    ], { temperature, max_tokens: maxTokens });
    const text = data.content[0].text;
    return this._extractJson(text);
  }

  /**
   * @private
   */
  async _messagesRequest(messages, params = {}) {
    const url = `${this.baseUrl}/messages`;
    const body = {
      model: this.model,
      messages,
      ...params
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
    }

    return response.json();
  }
}

module.exports = AnthropicAdapter;
