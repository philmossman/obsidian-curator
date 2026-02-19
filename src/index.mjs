// ESM wrapper for obsidian-curator (CJS package with ESM re-exports)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pkg = require('./index.js');

export const {
  VaultClient,
  Curator,
  loadConfig,
  createAIAdapter,
  NoneAdapter,
  OpenAIAdapter,
  AnthropicAdapter,
  OllamaAdapter,
  validateConfig,
  getCanonicalFolders,
  getSystemPaths,
  getRootExceptions,
  DEFAULTS,
  PRESET_FOLDERS,
  VALID_PROVIDERS,
  VALID_PRESETS,
  sanitizeUnicode,
  friendlyCouchError
} = pkg;

export default pkg;
