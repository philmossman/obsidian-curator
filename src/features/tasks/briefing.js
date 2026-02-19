'use strict';

/**
 * Task Briefing — compact task summary for inclusion in daily briefs.
 *
 * Generates a formatted markdown string showing overdue, due-soon,
 * upcoming, and undated task counts.
 *
 * Usage:
 *   const { generateTaskBrief } = require('./briefing');
 *   const brief = await generateTaskBrief(store);
 */

const { differenceInDays, format } = require('date-fns');

/**
 * Generate a task summary string for a morning brief / status report.
 *
 * @param {Object} store - TaskStore instance
 * @returns {Promise<string>} Formatted task brief (markdown)
 */
async function generateTaskBrief(store) {
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

  // Overdue
  const topOverdue = overdue.slice(0, 3);
  if (topOverdue.length > 0) {
    lines.push('');
    lines.push('🔴 *Overdue:*');
    for (const task of topOverdue) {
      const days     = differenceInDays(new Date(todayStr), new Date(task.due));
      const dayLabel = days === 1 ? '1 day' : `${days} days`;
      const pFlag    = task.priority === 'high' ? ' ⚡' : '';
      lines.push(`  • ${task.title}${pFlag} _(${dayLabel} overdue)_`);
    }
    if (overdue.length > 3) {
      lines.push(`  _...and ${overdue.length - 3} more overdue_`);
    }
  }

  // Due soon (exclude overdue)
  const dueSoonFiltered = dueSoon.filter(t => t.due >= todayStr);
  const topSoon         = dueSoonFiltered.slice(0, 3);
  if (topSoon.length > 0) {
    lines.push('');
    lines.push('🟡 *Due soon:*');
    const tomorrowStr = format(
      new Date(new Date().setDate(new Date().getDate() + 1)),
      'yyyy-MM-dd'
    );
    for (const task of topSoon) {
      const isToday    = task.due === todayStr;
      const isTomorrow = task.due === tomorrowStr;
      const dateLabel  = isToday ? 'today' : isTomorrow ? 'tomorrow' : task.due;
      const pFlag      = task.priority === 'high' ? ' ⚡' : '';
      lines.push(`  • ${task.title}${pFlag} _(${dateLabel})_`);
    }
    if (dueSoonFiltered.length > 3) {
      lines.push(`  _...and ${dueSoonFiltered.length - 3} more due soon_`);
    }
  }

  // Summary line
  const afterTomorrow    = format(
    new Date(new Date().setDate(new Date().getDate() + 1)),
    'yyyy-MM-dd'
  );
  const upcomingCount = allOpen.filter(t => t.due && t.due > afterTomorrow).length;
  const nodateCount   = allOpen.filter(t => !t.due).length;

  if (upcomingCount > 0 || nodateCount > 0) {
    lines.push('');
    const parts = [];
    if (upcomingCount > 0) parts.push(`${upcomingCount} upcoming`);
    if (nodateCount   > 0) parts.push(`${nodateCount} undated`);
    lines.push(`_Also: ${parts.join(', ')}_`);
  }

  return lines.join('\n');
}

module.exports = { generateTaskBrief };
