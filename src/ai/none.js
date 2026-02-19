'use strict';

/**
 * No-op AI adapter for rule-based-only mode.
 * All methods return null/empty values. No API calls are made.
 * Used when config.ai.provider = "none".
 */

const AIAdapter = require('./adapter');

class NoneAdapter extends AIAdapter {
  constructor(config = {}) {
    super(config);
    this.model = null;
  }

  /**
   * @returns {Promise<null>}
   */
  async complete(prompt, options = {}) {
    return null;
  }

  /**
   * @returns {Promise<null>}
   */
  async structured(prompt, schema, options = {}) {
    return null;
  }
}

module.exports = NoneAdapter;
