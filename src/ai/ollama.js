'use strict';

/**
 * Ollama adapter.
 * Talks to a local (or remote) Ollama server via its REST API.
 * Uses fetch (Node 18+). No SDK dependency.
 */

const AIAdapter = require('./adapter');

const DEFAULT_BASE_URL = 'http://localhost:11434';

class OllamaAdapter extends AIAdapter {
  /**
   * @param {Object} config
   * @param {string} config.model - Required: Ollama model name (e.g. "llama3", "qwen2.5-coder:7b")
   * @param {string} [config.baseUrl='http://localhost:11434']
   */
  constructor(config = {}) {
    super(config);
    if (!config.model) throw new Error('Ollama adapter requires config.ai.model');
    this.model = config.model;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  /**
   * @param {string} prompt
   * @param {Object} [options]
   * @param {number} [options.temperature=0.3]
   * @param {number} [options.maxTokens=4096]
   * @returns {Promise<string>}
   */
  async complete(prompt, options = {}) {
    const { temperature = 0.3, maxTokens = 4096 } = options;
    const url = `${this.baseUrl}/api/generate`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        options: {
          temperature,
          num_predict: maxTokens
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Ollama API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return data.response;
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
    const jsonPrompt = `${prompt}\n\nRespond with ONLY valid JSON matching this schema:\n${JSON.stringify(schema, null, 2)}\n\nOutput ONLY the JSON object, nothing else:\n`;
    const text = await this.complete(jsonPrompt, { temperature, maxTokens });
    return this._extractJson(text);
  }
}

module.exports = OllamaAdapter;
