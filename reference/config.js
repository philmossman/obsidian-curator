/**
 * Configuration loader with defaults
 */

const fs = require('fs');
const path = require('path');

// Default configuration
const defaults = {
  couchdb: {
    host: '127.0.0.1',
    port: 5984,
    database: 'obsidian',
    username: 'your_username',
    password: 'your_password'
  },
  processor: {
    defaultModel: 'qwen2.5-coder:7b',
    fallbackModel: 'anthropic/claude-sonnet-4-5',
    defaultLimit: 10,
    ollamaHost: 'http://localhost:11434',
    vaultStructureCachePath: path.join(__dirname, 'vault-structure.json'),
    vaultStructureMaxAge: 6 * 60 * 60 * 1000 // 6 hours in milliseconds
  },
  inbox: {
    path: 'inbox/'
  },
  filer: {
    defaultLimit: 10,
    minConfidence: 0.7,
    reviewQueuePath: 'inbox/review-queue/',
    enableLearning: true,
    maxHistorySessions: 100
  }
};

/**
 * Load configuration from config.json with fallback to defaults
 * @param {string} configPath - Path to config file (optional)
 * @returns {Object} Merged configuration
 */
function loadConfig(configPath = null) {
  const configFile = configPath || path.join(__dirname, 'config.json');
  
  // Start with defaults
  let config = JSON.parse(JSON.stringify(defaults));
  
  // Try to load config file
  try {
    if (fs.existsSync(configFile)) {
      const userConfig = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      config = deepMerge(config, userConfig);
    }
  } catch (err) {
    console.warn(`Warning: Could not load config from ${configFile}:`, err.message);
    console.warn('Using default configuration');
  }
  
  return config;
}

/**
 * Deep merge two objects
 * @param {Object} target - Target object
 * @param {Object} source - Source object
 * @returns {Object} Merged object
 */
function deepMerge(target, source) {
  const output = { ...target };
  
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      output[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      output[key] = source[key];
    }
  }
  
  return output;
}

module.exports = loadConfig;
module.exports.defaults = defaults;
