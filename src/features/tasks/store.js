'use strict';

/**
 * TaskStore — CRUD operations for vault tasks.
 *
 * Tasks are stored as Obsidian markdown notes in the configured tasks folder
 * (config.tasks.folder), each with YAML frontmatter containing metadata.
 *
 * Usage:
 *   const TaskStore = require('./store');
 *   const store = new TaskStore(vault, config);
 *   await store.createTask({ title: 'Chase the farrier', due: '2026-02-24' });
 *   const tasks = await store.listTasks({ status: 'open' });
 *   await store.completeTask('farrier');
 */

const { format, differenceInDays, addHours } = require('date-fns');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a title to a URL-safe slug (max 50 chars).
 * @param {string} title
 * @returns {string}
 */
function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50)
    .replace(/-$/, '');
}

/**
 * Extract the H1 title from note content.
 * @param {string} content
 * @returns {string}
 */
function extractH1(content) {
  for (const line of content.split('\n')) {
    const m = line.match(/^#\s+(.+)$/);
    if (m) return m[1].trim();
  }
  return 'Untitled task';
}

/**
 * Today's date as YYYY-MM-DD.
 * @returns {string}
 */
function today() {
  return format(new Date(), 'yyyy-MM-dd');
}

// ─── TaskStore class ──────────────────────────────────────────────────────────

class TaskStore {
  /**
   * @param {Object} vault  - VaultClient instance
   * @param {Object} config - Loaded curator config
   */
  constructor(vault, config) {
    if (!vault)  throw new Error('TaskStore requires a vault (VaultClient instance)');
    if (!config) throw new Error('TaskStore requires config');

    this.vault       = vault;
    this.tasksFolder = (config.tasks && config.tasks.folder) || 'Tasks';
  }

  /**
   * Create a new task note in the vault.
   *
   * @param {Object} taskData
   * @param {string}          taskData.title    - Task title
   * @param {string|null}     taskData.due      - Due date (YYYY-MM-DD)
   * @param {string|null}     taskData.project  - Project name
   * @param {'high'|'normal'|'low'} taskData.priority
   * @param {string}          [taskData.source] - Source tag (default: 'cli')
   * @returns {Promise<Object>} Created task object
   */
  async createTask(taskData) {
    const { title, due = null, project = null, priority = 'normal', source = 'cli' } = taskData;
    const created = today();

    // Unique filename
    const slug     = slugify(title);
    const uid      = Date.now().toString(36);
    const notePath = `${this.tasksFolder}/${slug}-${uid}.md`;

    const frontmatter = {
      type:      'task',
      status:    'open',
      priority,
      due:       due || 'null',
      project:   project || 'null',
      created,
      completed: 'null',
      tags:      ['task']
    };

    const body    = `# ${title}\n\nCaptured from ${source} on ${created}\n`;
    const content = this.vault.buildNote(frontmatter, body);

    await this.vault.writeNote(notePath, content);
    return { path: notePath, title, due, project, priority, status: 'open', created };
  }

  /**
   * List tasks with optional filters.
   *
   * @param {Object}  [filters]
   * @param {string}  [filters.status]   - 'open' | 'done'
   * @param {string}  [filters.project]  - Project name (case-insensitive)
   * @param {string}  [filters.priority] - 'high' | 'normal' | 'low'
   * @param {string}  [filters.due]      - Exact due date (YYYY-MM-DD)
   * @returns {Promise<Array<Object>>}
   */
  async listTasks(filters = {}) {
    const notes     = await this.vault.listNotes();
    const taskNotes = notes.filter(n => n.path && n.path.startsWith(`${this.tasksFolder}/`));
    const tasks     = [];

    for (const note of taskNotes) {
      try {
        const noteData = await this.vault.readNote(note.path);
        if (!noteData) continue;

        const { frontmatter } = this.vault.parseFrontmatter(noteData.content);

        if (frontmatter.type !== 'task') continue;

        // Normalise "null" strings → actual null
        const due       = (frontmatter.due       === 'null' || !frontmatter.due)       ? null : frontmatter.due;
        const project   = (frontmatter.project   === 'null' || !frontmatter.project)   ? null : frontmatter.project;
        const completed = (frontmatter.completed === 'null' || !frontmatter.completed) ? null : frontmatter.completed;

        const task = {
          path:      note.path,
          title:     extractH1(noteData.content),
          status:    frontmatter.status   || 'open',
          priority:  frontmatter.priority || 'normal',
          due,
          project,
          created:   frontmatter.created  || null,
          completed
        };

        if (filters.status   && task.status !== filters.status) continue;
        if (filters.project  && (task.project || '').toLowerCase() !== filters.project.toLowerCase()) continue;
        if (filters.priority && task.priority !== filters.priority) continue;
        if (filters.due      && task.due !== filters.due) continue;

        tasks.push(task);
      } catch (err) {
        console.error(`[task-store] Could not read ${note.path}: ${err.message}`);
      }
    }

    // Sort: overdue/soonest first, undated last
    tasks.sort((a, b) => {
      const aDate = a.due || 'z';
      const bDate = b.due || 'z';
      return aDate.localeCompare(bDate);
    });

    return tasks;
  }

  /**
   * Mark a task as complete by partial title search or exact path.
   *
   * @param {string} searchTerm - Part of the title, or exact path
   * @returns {Promise<{ ok: boolean, task: Object|null, message: string }>}
   */
  async completeTask(searchTerm) {
    if (!searchTerm || !searchTerm.trim()) {
      return { ok: false, task: null, message: 'No search term provided' };
    }

    const term      = searchTerm.trim().toLowerCase();
    const openTasks = await this.listTasks({ status: 'open' });

    let match = openTasks.find(t => t.path === searchTerm);
    if (!match) match = openTasks.find(t => t.title.toLowerCase().includes(term));
    if (!match) {
      return { ok: false, task: null, message: `No open task found matching "${searchTerm}"` };
    }

    const noteData = await this.vault.readNote(match.path);
    if (!noteData) {
      return { ok: false, task: null, message: `Could not read task note: ${match.path}` };
    }

    const { frontmatter, body } = this.vault.parseFrontmatter(noteData.content);
    frontmatter.status    = 'done';
    frontmatter.completed = today();

    const updatedContent = this.vault.buildNote(frontmatter, body);
    await this.vault.writeNote(match.path, updatedContent);

    return {
      ok:      true,
      task:    { ...match, status: 'done', completed: today() },
      message: `Completed: ${match.title}`
    };
  }

  /**
   * Get all overdue open tasks.
   * @returns {Promise<Array<Object>>}
   */
  async getOverdue() {
    const todayStr = today();
    const tasks    = await this.listTasks({ status: 'open' });
    return tasks.filter(t => t.due && t.due < todayStr);
  }

  /**
   * Get tasks due within the next 48 hours (including today).
   * @returns {Promise<Array<Object>>}
   */
  async getDueSoon() {
    const todayStr = today();
    const soonStr  = format(addHours(new Date(), 48), 'yyyy-MM-dd');
    const tasks    = await this.listTasks({ status: 'open' });
    return tasks.filter(t => t.due && t.due >= todayStr && t.due <= soonStr);
  }

  /**
   * Get a single task by vault path.
   * @param {string} notePath
   * @returns {Promise<Object|null>}
   */
  async getTask(notePath) {
    try {
      const noteData = await this.vault.readNote(notePath);
      if (!noteData) return null;
      const { frontmatter } = this.vault.parseFrontmatter(noteData.content);
      return {
        path:      notePath,
        title:     extractH1(noteData.content),
        status:    frontmatter.status   || 'open',
        priority:  frontmatter.priority || 'normal',
        due:       (frontmatter.due       === 'null' || !frontmatter.due)       ? null : frontmatter.due,
        project:   (frontmatter.project   === 'null' || !frontmatter.project)   ? null : frontmatter.project,
        created:   frontmatter.created  || null,
        completed: (frontmatter.completed === 'null' || !frontmatter.completed) ? null : frontmatter.completed
      };
    } catch {
      return null;
    }
  }

  /**
   * How many days overdue is a task? Returns a positive integer if overdue.
   * @param {Object} task
   * @returns {number}
   */
  daysOverdue(task) {
    if (!task.due) return 0;
    const todayStr = today();
    if (task.due >= todayStr) return 0;
    return differenceInDays(new Date(todayStr), new Date(task.due));
  }
}

module.exports = TaskStore;
module.exports.slugify   = slugify;
module.exports.extractH1 = extractH1;
