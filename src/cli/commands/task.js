'use strict';

/**
 * task command — create a new task from natural language.
 *
 * Usage:
 *   obsidian-curator task "description of the task"
 */

const { loadConfig }   = require('../../core/config');
const VaultClient       = require('../../core/vault-client');
const Curator           = require('../../core/curator');
const { info, error, success, muted, warn } = require('../helpers');

/**
 * @param {Object} args - Parsed arguments
 * @returns {Promise<void>}
 */
async function taskCommand(args) {
  const description = args._.join(' ').trim();

  if (!description) {
    error('No description provided. Usage: obsidian-curator task "description"');
    process.exit(1);
  }

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    error(`Config error: ${err.message}`);
    muted('Run `obsidian-curator init` to set up your configuration.');
    process.exit(1);
  }

  let curator;
  try {
    const vault = new VaultClient(config.vault);
    curator     = new Curator({ vault, ai: null, config });
  } catch (err) {
    error(`Connection failed: ${err.message}`);
    process.exit(1);
  }

  let task;
  try {
    task = await curator.createTask(description);
  } catch (err) {
    error(`Failed to create task: ${err.message}`);
    process.exit(1);
  }

  success(`Task created: ${task.title}`);
  if (task.due)     info(`  Due: ${task.due}`);
  if (task.project) info(`  Project: ${task.project}`);
  if (task.priority !== 'normal') info(`  Priority: ${task.priority}`);
  muted(`  Path: ${task.path}`);
}

module.exports = taskCommand;
