/**
 * Task Store - CRUD operations for vault tasks
 *
 * Tasks are stored as Obsidian markdown notes in the Tasks/ folder,
 * each with YAML frontmatter containing metadata.
 *
 * Usage:
 *   const TaskStore = require('./task-store');
 *   const store = new TaskStore();
 *   await store.createTask({ title: 'Chase the farrier', due: '2026-02-24', ... });
 *   const tasks = await store.listTasks({ status: 'open' });
 *   await store.completeTask('farrier');
 */

const VaultClient = require('./vault-client');
const config = require('./config.json');
const { format, differenceInDays, addHours, parseISO, isValid } = require('date-fns');

const TASKS_FOLDER = 'Tasks';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a title to a URL-safe slug.
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
  const lines = content.split('\n');
  for (const line of lines) {
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

/**
 * Check if a date string is in the past.
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {boolean}
 */
function isPast(dateStr) {
  if (!dateStr) return false;
  return dateStr < today();
}

// ─── TaskStore Class ──────────────────────────────────────────────────────────

class TaskStore {
  constructor(vaultClientOverride = null) {
    this.vault = vaultClientOverride || new VaultClient(config.couchdb);
  }

  /**
   * Create a new task note in the vault.
   *
   * @param {Object} taskData
   * @param {string} taskData.title - Task title
   * @param {string|null} taskData.due - Due date (YYYY-MM-DD)
   * @param {string|null} taskData.project - Project name
   * @param {'high'|'normal'|'low'} taskData.priority - Priority level
   * @param {string} [taskData.source] - Source of capture (default: 'telegram')
   * @returns {Promise<{path: string, title: string, due: string|null, project: string|null, priority: string}>}
   */
  async createTask(taskData) {
    const { title, due = null, project = null, priority = 'normal', source = 'telegram' } = taskData;
    const created = today();

    // Generate a unique filename
    const slug = slugify(title);
    const uid = Date.now().toString(36); // short base-36 timestamp for uniqueness
    const notePath = `${TASKS_FOLDER}/${slug}-${uid}.md`;

    const frontmatter = {
      type: 'task',
      status: 'open',
      priority,
      due: due || 'null',
      project: project || 'null',
      created,
      completed: 'null',
      tags: ['task']
    };

    const body = `# ${title}\n\nCaptured from ${source} on ${created}\n`;
    const content = this.vault.buildNote(frontmatter, body);

    await this.vault.writeNote(notePath, content);
    return { path: notePath, title, due, project, priority, status: 'open', created };
  }

  /**
   * List tasks with optional filters.
   *
   * @param {Object} [filters]
   * @param {string} [filters.status] - 'open' | 'done'
   * @param {string} [filters.project] - Project name (case-insensitive)
   * @param {string} [filters.priority] - 'high' | 'normal' | 'low'
   * @param {string} [filters.due] - Exact due date (YYYY-MM-DD)
   * @returns {Promise<Array<Object>>} Array of task objects
   */
  async listTasks(filters = {}) {
    const notes = await this.vault.listNotes();
    const taskNotes = notes.filter(n => n.path && n.path.startsWith(`${TASKS_FOLDER}/`));

    const tasks = [];

    for (const note of taskNotes) {
      try {
        const noteData = await this.vault.readNote(note.path);
        if (!noteData) continue;

        const { frontmatter } = this.vault.parseFrontmatter(noteData.content);

        // Only process documents marked as tasks
        if (frontmatter.type !== 'task') continue;

        // Normalise null strings → actual null
        const due = (frontmatter.due === 'null' || !frontmatter.due) ? null : frontmatter.due;
        const project = (frontmatter.project === 'null' || !frontmatter.project) ? null : frontmatter.project;
        const completed = (frontmatter.completed === 'null' || !frontmatter.completed) ? null : frontmatter.completed;

        const task = {
          path: note.path,
          title: extractH1(noteData.content),
          status: frontmatter.status || 'open',
          priority: frontmatter.priority || 'normal',
          due,
          project,
          created: frontmatter.created || null,
          completed
        };

        // Apply filters
        if (filters.status && task.status !== filters.status) continue;
        if (filters.project && (task.project || '').toLowerCase() !== filters.project.toLowerCase()) continue;
        if (filters.priority && task.priority !== filters.priority) continue;
        if (filters.due && task.due !== filters.due) continue;

        tasks.push(task);
      } catch (err) {
        // Skip unreadable notes rather than failing the whole list
        console.error(`[task-store] Could not read ${note.path}: ${err.message}`);
      }
    }

    // Sort: overdue → due today → future → no date
    tasks.sort((a, b) => {
      const aDate = a.due || 'z'; // 'z' sorts after all dates
      const bDate = b.due || 'z';
      return aDate.localeCompare(bDate);
    });

    return tasks;
  }

  /**
   * Mark a task as complete. Finds the task by partial title search or exact path.
   *
   * @param {string} searchTerm - Part of the title, or exact path
   * @returns {Promise<{ok: boolean, task: Object|null, message: string}>}
   */
  async completeTask(searchTerm) {
    if (!searchTerm || !searchTerm.trim()) {
      return { ok: false, task: null, message: 'No search term provided' };
    }

    const term = searchTerm.trim().toLowerCase();
    const openTasks = await this.listTasks({ status: 'open' });

    // Find by exact path first, then by title match
    let match = openTasks.find(t => t.path === searchTerm);
    if (!match) {
      match = openTasks.find(t => t.title.toLowerCase().includes(term));
    }
    if (!match) {
      return { ok: false, task: null, message: `No open task found matching "${searchTerm}"` };
    }

    // Read the note, update frontmatter
    const noteData = await this.vault.readNote(match.path);
    if (!noteData) {
      return { ok: false, task: null, message: `Could not read task note: ${match.path}` };
    }

    const { frontmatter, body } = this.vault.parseFrontmatter(noteData.content);
    frontmatter.status = 'done';
    frontmatter.completed = today();

    const updatedContent = this.vault.buildNote(frontmatter, body);
    await this.vault.writeNote(match.path, updatedContent);

    return { ok: true, task: { ...match, status: 'done', completed: today() }, message: `✅ Completed: ${match.title}` };
  }

  /**
   * Get all overdue tasks (open tasks with a past due date).
   * @returns {Promise<Array<Object>>}
   */
  async getOverdue() {
    const todayStr = today();
    const tasks = await this.listTasks({ status: 'open' });
    return tasks.filter(t => t.due && t.due < todayStr);
  }

  /**
   * Get tasks due within the next 48 hours (including today).
   * @returns {Promise<Array<Object>>}
   */
  async getDueSoon() {
    const todayStr = today();
    const soonStr = format(addHours(new Date(), 48), 'yyyy-MM-dd');
    const tasks = await this.listTasks({ status: 'open' });
    return tasks.filter(t => t.due && t.due >= todayStr && t.due <= soonStr);
  }

  /**
   * Get a single task by path.
   * @param {string} path
   * @returns {Promise<Object|null>}
   */
  async getTask(path) {
    try {
      const noteData = await this.vault.readNote(path);
      if (!noteData) return null;
      const { frontmatter } = this.vault.parseFrontmatter(noteData.content);
      const due = (frontmatter.due === 'null' || !frontmatter.due) ? null : frontmatter.due;
      const project = (frontmatter.project === 'null' || !frontmatter.project) ? null : frontmatter.project;
      return {
        path,
        title: extractH1(noteData.content),
        status: frontmatter.status || 'open',
        priority: frontmatter.priority || 'normal',
        due,
        project,
        created: frontmatter.created || null,
        completed: (frontmatter.completed === 'null' || !frontmatter.completed) ? null : frontmatter.completed
      };
    } catch {
      return null;
    }
  }

  /**
   * How many days overdue is a task? Returns positive int if overdue.
   * @param {Object} task
   * @returns {number} Days overdue (0 if not overdue)
   */
  daysOverdue(task) {
    if (!task.due) return 0;
    const todayStr = today();
    if (task.due >= todayStr) return 0;
    return differenceInDays(
      new Date(todayStr),
      new Date(task.due)
    );
  }
}

module.exports = TaskStore;
module.exports.slugify = slugify;
module.exports.extractH1 = extractH1;
module.exports.TASKS_FOLDER = TASKS_FOLDER;
