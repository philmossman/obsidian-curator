'use strict';

/**
 * OpenAI-compatible adapter.
 * Works with OpenAI, OpenRouter, local OpenAI-compatible servers (LM Studio, etc.),
 * or any custom baseUrl that speaks the OpenAI chat completions API.
 *
 * Uses fetch (Node 18+ built-in), no SDK dependency.
 */

const AIAdapter = require('./adapter');

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

class OpenAIAdapter extends AIAdapter {
  /**
   * @param {Object} config
   * @param {string} config.apiKey - OpenAI API key (or compatible)
   * @param {string} [config.model='gpt-4o-mini']
   * @param {string} [config.baseUrl='https://api.openai.com/v1']
   */
  constructor(config = {}) {
    super(config);
    if (!config.apiKey) throw new Error('OpenAI adapter requires config.ai.apiKey');
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
    const data = await this._chatRequest([
      { role: 'user', content: prompt }
    ], { temperature, max_tokens: maxTokens });
    return data.choices[0].message.content;
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
    const data = await this._chatRequest([
      { role: 'user', content: jsonPrompt }
    ], { temperature, max_tokens: maxTokens });
    const text = data.choices[0].message.content;
    return this._extractJson(text);
  }

  /**
   * @private
   */
  async _chatRequest(messages, params = {}) {
    const url = `${this.baseUrl}/chat/completions`;
    const body = {
      model: this.model,
      messages,
      ...params
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
    }

    return response.json();
  }
}

module.exports = OpenAIAdapter;
