#!/usr/bin/env node
'use strict';

/**
 * obsidian-curator CLI entry point.
 *
 * Usage:
 *   obsidian-curator <command> [options]
 *
 * Commands:
 *   init                    Interactive setup wizard
 *   capture "text"          Quick-capture text to the inbox
 *   process                 AI-enrich inbox notes
 *   file                    AI-route processed notes to vault folders
 *   audit                   Check vault structure
 *   tidy [dupes|structure|stubs]  Vault housekeeping
 *   tasks                   List open tasks
 *   task "description"      Create a new task
 *   done "search"           Mark a task as done
 *   config show|set|path    Manage configuration
 *
 * Options:
 *   --help, -h              Show this help message
 *   --version, -v           Show version number
 */

const path = require('path');
const { parseArgs, error, muted, coloured, ANSI } = require('./helpers');

// ─────────────────────────────────────────────
// Version
// ─────────────────────────────────────────────

let VERSION = '0.1.0';
try {
  const pkg = require('../../package.json');
  VERSION = pkg.version || VERSION;
} catch (_) {}

// ─────────────────────────────────────────────
// Help text
// ─────────────────────────────────────────────

const HELP = `
${coloured(ANSI.bold, 'obsidian-curator')} ${coloured(ANSI.grey, `v${VERSION}`)} — Manage Obsidian vaults via LiveSync CouchDB

${coloured(ANSI.bold, 'USAGE')}
  obsidian-curator <command> [options]

${coloured(ANSI.bold, 'COMMANDS')}
  ${coloured(ANSI.cyan, 'init')}                       Interactive setup wizard
  ${coloured(ANSI.cyan, 'capture')} "text"             Quick-capture text to inbox
  ${coloured(ANSI.cyan, 'process')} [--limit N]        AI-enrich inbox notes
              [--dry-run]
              [--force]
  ${coloured(ANSI.cyan, 'file')}    [--limit N]        AI-route notes to vault folders
              [--dry-run]
  ${coloured(ANSI.cyan, 'audit')}                      Check vault structure
  ${coloured(ANSI.cyan, 'tidy')}    [dupes|structure|stubs]  Housekeeping
              [--dry-run]
  ${coloured(ANSI.cyan, 'tasks')}   [--project X]      List open tasks
              [--priority high]
  ${coloured(ANSI.cyan, 'task')}    "description"      Create a new task
  ${coloured(ANSI.cyan, 'done')}    "search"           Mark a task done
  ${coloured(ANSI.cyan, 'config')}  show|set|path      Manage configuration

${coloured(ANSI.bold, 'OPTIONS')}
  --help, -h                Show this help message
  --version, -v             Show version

${coloured(ANSI.bold, 'EXAMPLES')}
  obsidian-curator init
  obsidian-curator capture "Remember to call Alice"
  obsidian-curator process --limit 5
  obsidian-curator config show
  obsidian-curator config set vault.host myserver.local
`.trimStart();

// ─────────────────────────────────────────────
// Command routing
// ─────────────────────────────────────────────

/**
 * Map of command name → module loader (lazy to keep startup fast).
 */
const COMMANDS = {
  init:    () => require('./wizard'),
  capture: () => require('./commands/capture'),
  process: () => require('./commands/process'),
  file:    () => require('./commands/file'),
  audit:   () => require('./commands/audit'),
  tidy:    () => require('./commands/tidy'),
  tasks:   () => require('./commands/tasks'),
  task:    () => require('./commands/task'),
  done:    () => require('./commands/done'),
  config:  () => require('./commands/config'),
};

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  // --version / -v
  if (args.version || args.v) {
    console.log(VERSION);
    return;
  }

  // --help / -h (or no command)
  if (args.help || args.h || args._.length === 0) {
    console.log(HELP);
    return;
  }

  const command = args._[0];
  // Shift the command out of positional args so each handler receives clean positionals
  args._ = args._.slice(1);

  const loader = COMMANDS[command];
  if (!loader) {
    error(`Unknown command: ${command}`);
    muted(`Run ${coloured(ANSI.cyan, 'obsidian-curator --help')} to see available commands.`);
    process.exit(1);
  }

  const handler = loader();

  // init is the wizard (special case: called directly with no args)
  if (command === 'init') {
    let existingConfig = null;
    try {
      const { loadConfig } = require('../core/config');
      existingConfig = loadConfig();
    } catch (_) {
      // No existing config — fine, wizard starts from defaults
    }
    await handler(existingConfig);
  } else {
    await handler(args);
  }
}

main().catch(err => {
  error(err.message || String(err));
  process.exit(1);
});
