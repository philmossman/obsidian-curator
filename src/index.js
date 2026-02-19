'use strict';

/**
 * obsidian-curator — main entry point.
 *
 * Core exports:
 *   VaultClient    — CouchDB/LiveSync CRUD operations
 *   Curator        — Main orchestrator
 *   createAIAdapter — Factory: returns AI adapter for the configured provider
 *   loadConfig     — Load, merge and validate configuration
 *
 * Example:
 *   const { VaultClient, Curator, createAIAdapter, loadConfig } = require('obsidian-curator');
 *   const config  = loadConfig();
 *   const vault   = new VaultClient(config.vault);
 *   const ai      = createAIAdapter(config);
 *   const curator = new Curator({ vault, ai, config });
 */

const VaultClient = require('./core/vault-client');
const Curator = require('./core/curator');
const loadConfig = require('./core/config');
const createAIAdapter = require('./ai/index');

// Re-export individual adapter classes for users who want direct access
const { NoneAdapter, OpenAIAdapter, AnthropicAdapter, OllamaAdapter } = require('./ai/index');

// Re-export helpers
const { sanitizeUnicode, friendlyCouchError } = require('./core/vault-client');
const {
  validateConfig,
  getCanonicalFolders,
  getSystemPaths,
  getRootExceptions,
  DEFAULTS,
  PRESET_FOLDERS,
  VALID_PROVIDERS,
  VALID_PRESETS
} = require('./core/config');

module.exports = {
  // Core
  VaultClient,
  Curator,
  loadConfig,
  createAIAdapter,

  // AI adapters
  NoneAdapter,
  OpenAIAdapter,
  AnthropicAdapter,
  OllamaAdapter,

  // Config helpers
  validateConfig,
  getCanonicalFolders,
  getSystemPaths,
  getRootExceptions,
  DEFAULTS,
  PRESET_FOLDERS,
  VALID_PROVIDERS,
  VALID_PRESETS,

  // Vault helpers
  sanitizeUnicode,
  friendlyCouchError
};
