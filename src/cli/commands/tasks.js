'use strict';

/**
 * tasks command — list open tasks with grouping and formatting.
 *
 * Usage:
 *   obsidian-curator tasks [--project X] [--priority high] [--all]
 */

const { format }       = require('date-fns');
const { loadConfig }   = require('../../core/config');
const VaultClient       = require('../../core/vault-client');
const Curator           = require('../../core/curator');
const { info, warn, error, success, muted, spinner, header, ANSI, coloured } = require('../helpers');

/**
 * @param {Object} args - Parsed arguments
 * @returns {Promise<void>}
 */
async function tasksCommand(args) {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    error(`Config error: ${err.message}`);
    muted('Run `obsidian-curator init` to set up your configuration.');
    process.exit(1);
  }

  const filters = {};
  if (args.project)  filters.project  = args.project;
  if (args.priority) filters.priority = args.priority;
  if (!args.all)     filters.status   = 'open';

  const spin = spinner('Loading tasks…');
  let curator;
  try {
    const vault = new VaultClient(config.vault);
    curator     = new Curator({ vault, ai: null, config });
    spin.stop();
  } catch (err) {
    spin.stop();
    error(`Connection failed: ${err.message}`);
    process.exit(1);
  }

  let tasks;
  try {
    tasks = await curator.tasks(filters);
  } catch (err) {
    error(`Could not load tasks: ${err.message}`);
    process.exit(1);
  }

  if (tasks.length === 0) {
    success('No tasks found.');
    if (filters.project)  muted(`  Filter: project = ${filters.project}`);
    if (filters.priority) muted(`  Filter: priority = ${filters.priority}`);
    return;
  }

  const todayStr    = format(new Date(), 'yyyy-MM-dd');
  const tomorrowStr = format(new Date(new Date().setDate(new Date().getDate() + 1)), 'yyyy-MM-dd');

  // ── Group tasks ─────────────────────────────────────────────────────────────
  const overdue  = tasks.filter(t => t.due && t.due < todayStr);
  const dueSoon  = tasks.filter(t => t.due && (t.due === todayStr || t.due === tomorrowStr));
  const upcoming = tasks.filter(t => t.due && t.due > tomorrowStr);
  const undated  = tasks.filter(t => !t.due);

  const printTask = (task) => {
    const pFlag  = task.priority === 'high' ? ' ⚡' : task.priority === 'low' ? ' ·' : '';
    const pName  = task.project  ? ` [${task.project}]` : '';
    const dueTag = task.due      ? ` (${task.due})` : '';
    const title  = coloured(ANSI.white, task.title);
    console.log(`  • ${title}${pFlag}${coloured(ANSI.grey, pName + dueTag)}`);
  };

  header(`\nTasks (${tasks.length})`);

  if (overdue.length > 0) {
    console.log('');
    console.log(coloured(ANSI.red, `🔴 Overdue (${overdue.length}):`));
    overdue.forEach(printTask);
  }

  if (dueSoon.length > 0) {
    console.log('');
    console.log(coloured(ANSI.yellow, `🟡 Due today/tomorrow (${dueSoon.length}):`));
    dueSoon.forEach(printTask);
  }

  if (upcoming.length > 0) {
    console.log('');
    header(`Upcoming (${upcoming.length}):`);
    upcoming.forEach(printTask);
  }

  if (undated.length > 0) {
    console.log('');
    muted(`Undated (${undated.length}):`);
    undated.forEach(printTask);
  }
}

module.exports = tasksCommand;
