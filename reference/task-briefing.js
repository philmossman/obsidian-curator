/**
 * Task Briefing - Task summary for the daily morning brief
 *
 * Generates a compact, formatted task summary suitable for insertion
 * into the daily brief Telegram message.
 *
 * Usage:
 *   const { generateTaskBrief } = require('./task-briefing');
 *   const brief = await generateTaskBrief();
 *   // Returns a string ready to inject into the morning brief
 *
 * Called from: daily brief compilation step (8ddb910a cron)
 */

const TaskStore = require('./task-store');
const { differenceInDays, format } = require('date-fns');

/**
 * Generate a task summary string for the morning brief.
 *
 * @param {TaskStore} [storeOverride] - Optional TaskStore instance (for testing)
 * @returns {Promise<string>} Formatted task brief, or empty string if no tasks
 */
async function generateTaskBrief(storeOverride = null) {
  const store = storeOverride || new TaskStore();
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  let overdue, dueSoon, allOpen;
  try {
    [overdue, dueSoon, allOpen] = await Promise.all([
      store.getOverdue(),
      store.getDueSoon(),
      store.listTasks({ status: 'open' })
    ]);
  } catch (err) {
    return `⚠️ *Tasks* — could not load (${err.message})`;
  }

  const totalOpen = allOpen.length;

  if (totalOpen === 0) {
    return '✅ *Tasks* — inbox zero! No open tasks.';
  }

  const lines = [];
  lines.push(`📋 *Tasks* — ${totalOpen} open`);

  // ── Overdue ────────────────────────────────────────────────────────────────
  const topOverdue = overdue.slice(0, 3);
  if (topOverdue.length > 0) {
    lines.push('');
    lines.push('🔴 *Overdue:*');
    for (const task of topOverdue) {
      const days = differenceInDays(new Date(todayStr), new Date(task.due));
      const dayLabel = days === 1 ? '1 day' : `${days} days`;
      const priorityFlag = task.priority === 'high' ? ' ⚡' : '';
      lines.push(`  • ${task.title}${priorityFlag} _(${dayLabel} overdue)_`);
    }
    if (overdue.length > 3) {
      lines.push(`  _...and ${overdue.length - 3} more overdue_`);
    }
  }

  // ── Due today/tomorrow ─────────────────────────────────────────────────────
  // dueSoon = due within 48h, starting today. Filter out overdue ones.
  const dueSoonFiltered = dueSoon.filter(t => t.due >= todayStr);
  const topSoon = dueSoonFiltered.slice(0, 3);
  if (topSoon.length > 0) {
    lines.push('');
    lines.push('🟡 *Due soon:*');
    for (const task of topSoon) {
      const isToday = task.due === todayStr;
      const tomorrowStr = format(new Date(new Date().setDate(new Date().getDate() + 1)), 'yyyy-MM-dd');
      const isTomorrow = task.due === tomorrowStr;
      const dateLabel = isToday ? 'today' : isTomorrow ? 'tomorrow' : task.due;
      const priorityFlag = task.priority === 'high' ? ' ⚡' : '';
      lines.push(`  • ${task.title}${priorityFlag} _(${dateLabel})_`);
    }
    if (dueSoonFiltered.length > 3) {
      lines.push(`  _...and ${dueSoonFiltered.length - 3} more due soon_`);
    }
  }

  // ── Summary line ──────────────────────────────────────────────────────────
  const upcomingCount = allOpen.filter(t => t.due && t.due > format(new Date(new Date().setDate(new Date().getDate() + 1)), 'yyyy-MM-dd')).length;
  const nodateCount = allOpen.filter(t => !t.due).length;

  if (upcomingCount > 0 || nodateCount > 0) {
    lines.push('');
    const parts = [];
    if (upcomingCount > 0) parts.push(`${upcomingCount} upcoming`);
    if (nodateCount > 0) parts.push(`${nodateCount} undated`);
    lines.push(`_Also: ${parts.join(', ')}_`);
  }

  return lines.join('\n');
}

module.exports = { generateTaskBrief };

// CLI usage: node task-briefing.js
if (require.main === module) {
  generateTaskBrief().then(brief => {
    console.log(brief);
  }).catch(err => {
    console.error('Error generating task brief:', err.message);
    process.exit(1);
  });
}
