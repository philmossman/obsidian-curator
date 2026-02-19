'use strict';

/**
 * Auditor — vault structure analysis.
 *
 * Checks the vault against the configured canonical folder structure,
 * detects potential methodology, and provides recommendations.
 * No AI required — purely rule-based.
 */

const { getCanonicalFolders, getSystemPaths, getRootExceptions } = require('../core/config');

// ─────────────────────────────────────────────
// Methodology definitions (for detection)
// ─────────────────────────────────────────────

const METHODOLOGIES = {
  PARA: {
    name: 'PARA (Projects, Areas, Resources, Archives)',
    folders: ['Projects', 'Areas', 'Resources', 'Archives'],
    description: 'Actionability-based organization by Tiago Forte',
    idealFor: 'Goal-oriented work, GTD practitioners, actionable knowledge',
    rules: { maxDepth: 2, requireFolders: ['Projects', 'Areas', 'Resources', 'Archives'] }
  },
  Zettelkasten: {
    name: 'Zettelkasten (Slip-box)',
    folders: ['Slipbox', 'Literature', 'Fleeting', 'Permanent'],
    description: 'Atomic note-taking with heavy linking',
    idealFor: 'Research, writing, interconnected thinking',
    rules: { maxDepth: 1, preferFlat: true }
  },
  ACCESS: {
    name: 'ACCESS (Atlas, Calendar, Cards, Extras, Sources, Spaces)',
    folders: ['Atlas', 'Calendar', 'Cards', 'Extras', 'Sources', 'Spaces'],
    description: "Nick Milo's Linking Your Thinking system",
    idealFor: 'PKM enthusiasts, MOC-heavy workflows',
    rules: { maxDepth: 2 }
  }
};

// ─────────────────────────────────────────────
// StructureAuditor class
// ─────────────────────────────────────────────

class StructureAuditor {
  /**
   * @param {Object} vault  - VaultClient instance
   * @param {Object} config - Loaded curator config
   */
  constructor(vault, config) {
    if (!vault)  throw new Error('StructureAuditor requires a vault (VaultClient instance)');
    if (!config) throw new Error('StructureAuditor requires config');

    this.vault   = vault;
    this.config  = config;
    this.notes   = [];
    this.folders = new Map();
    this.issues  = [];
    this.recommendations = [];
    this.detectedMethodology = null;
  }

  /**
   * Run the full audit and return a structured report.
   * @returns {Promise<Object>}
   */
  async analyze() {
    await this._loadVaultData();

    this._detectMethodology();
    this._analyzeDepth();
    this._analyzeDistribution();
    this._analyzeNaming();
    this._analyzeOrphans();
    this._analyzeStructuralIssues();
    this._generateRecommendations();

    return this._generateReport();
  }

  // ── Data loading ──────────────────────────────────────────────────────────

  async _loadVaultData() {
    const systemPaths = getSystemPaths(this.config);
    const allNotes    = await this.vault.listNotes();

    // Filter out system paths
    this.notes = allNotes.filter(note => {
      if (!note.path) return false;
      const lower = note.path.toLowerCase();
      return !systemPaths.some(p => lower.startsWith(p.toLowerCase()));
    });

    this.folders = new Map();
    for (const note of this.notes) {
      const parts = note.path.split('/');
      if (parts.length > 1) {
        const folder = parts.slice(0, -1).join('/');
        if (!this.folders.has(folder)) this.folders.set(folder, []);
        this.folders.get(folder).push(note);
      }
    }
  }

  // ── Analysis steps ────────────────────────────────────────────────────────

  _detectMethodology() {
    const topFolders = Array.from(this.folders.keys())
      .filter(f => !f.includes('/'))
      .map(f => f.toLowerCase());

    const scores = {};
    for (const [key, method] of Object.entries(METHODOLOGIES)) {
      if (!method.folders) continue;
      const matches = method.folders.filter(f => topFolders.includes(f.toLowerCase())).length;
      scores[key] = {
        matches,
        total:      method.folders.length,
        percentage: (matches / method.folders.length) * 100,
        method
      };
    }

    const best = Object.entries(scores).sort((a, b) => b[1].percentage - a[1].percentage)[0];
    if (best && best[1].percentage >= 25) {
      this.detectedMethodology = {
        type:       best[0],
        ...best[1],
        confidence: best[1].percentage >= 75 ? 'high' : best[1].percentage >= 50 ? 'medium' : 'low'
      };
    }

    const multiplePartial = Object.values(scores).filter(s => s.percentage > 0 && s.percentage < 75);
    if (multiplePartial.length > 1) {
      this.issues.push({
        severity:       'medium',
        category:       'methodology',
        issue:          'Mixed methodology detected',
        detail:         `Found elements of ${multiplePartial.length} different systems: ` +
                        multiplePartial.map(s => s.method.name).join(', '),
        recommendation: 'Choose one methodology and commit to it fully'
      });
    }
  }

  _analyzeDepth() {
    const maxDepth          = Math.max(0, ...Array.from(this.folders.keys()).map(f => f.split('/').length));
    const recommendedMax    = this.detectedMethodology?.method.rules.maxDepth || 3;

    if (maxDepth > recommendedMax) {
      const deepFolders = Array.from(this.folders.entries())
        .filter(([f]) => f.split('/').length > recommendedMax)
        .map(([f, notes]) => ({ folder: f, count: notes.length }));

      this.issues.push({
        severity:       'low',
        category:       'depth',
        issue:          `Folder nesting too deep (max: ${maxDepth}, recommended: ${recommendedMax})`,
        detail:         `Deep folders: ${deepFolders.map(f => f.folder).join(', ')}`,
        recommendation: 'Flatten hierarchy or consolidate nested folders'
      });
    }
  }

  _analyzeDistribution() {
    const total       = this.notes.length;
    if (total === 0) return;

    const inboxFolder = (this.config.structure && this.config.structure.folders && this.config.structure.folders.inbox) || 'inbox';
    const workingFolders = [inboxFolder, 'drafts', 'temp', 'scratch'];

    const folderStats = Array.from(this.folders.entries())
      .map(([folder, notes]) => ({ folder, count: notes.length }));

    const workingNotes = folderStats
      .filter(f => workingFolders.some(w => f.folder.toLowerCase().startsWith(w.toLowerCase())))
      .reduce((sum, f) => sum + f.count, 0);

    if ((workingNotes / total) * 100 > 40) {
      this.issues.push({
        severity:       'high',
        category:       'distribution',
        issue:          'Too many notes in working folders',
        detail:         `${workingNotes}/${total} notes (${((workingNotes / total) * 100).toFixed(1)}%) in inbox/temp areas`,
        recommendation: 'Process and file notes regularly'
      });
    }

    // Single-note top-level folders
    const topLevelFolders    = Array.from(this.folders.keys()).filter(f => !f.includes('/'));
    const singleNoteFolders  = topLevelFolders.filter(folder => {
      const all = this.notes.filter(n => n.path.startsWith(folder + '/'));
      return all.length === 1;
    });

    if (singleNoteFolders.length > 3) {
      this.issues.push({
        severity:       'medium',
        category:       'distribution',
        issue:          'Many single-note folders (structural orphans)',
        detail:         `${singleNoteFolders.length} folders with only 1 note: ` +
                        singleNoteFolders.slice(0, 5).join(', ') + (singleNoteFolders.length > 5 ? '...' : ''),
        recommendation: 'Consolidate related folders or move notes to more populated areas'
      });
    }
  }

  _analyzeNaming() {
    const topFolders = Array.from(this.folders.keys()).filter(f => !f.includes('/'));

    const vagueNames = topFolders.filter(f =>
      f.toLowerCase().match(/^(misc|other|stuff|things|notes|general|random)$/i)
    );
    if (vagueNames.length > 0) {
      this.issues.push({
        severity:       'low',
        category:       'naming',
        issue:          'Vague folder names',
        detail:         `Unclear folders: ${vagueNames.join(', ')}`,
        recommendation: 'Use specific, descriptive names that indicate content'
      });
    }

    const casePatterns = topFolders.map(f => {
      if (f === f.toLowerCase()) return 'lower';
      if (f === f.toUpperCase()) return 'upper';
      if (f[0] === f[0].toUpperCase()) return 'title';
      return 'mixed';
    });
    const uniquePatterns = [...new Set(casePatterns)];
    if (uniquePatterns.length > 1) {
      this.issues.push({
        severity:       'low',
        category:       'naming',
        issue:          'Inconsistent capitalisation',
        detail:         `Mix of ${uniquePatterns.join(', ')} case in folder names`,
        recommendation: 'Standardise on Title Case or lowercase throughout'
      });
    }
  }

  _analyzeOrphans() {
    const rootExceptions = getRootExceptions(this.config).map(e => e.toLowerCase());
    const rootNotes = this.notes.filter(n => !n.path.includes('/'));

    const unexpectedRoot = rootNotes.filter(n =>
      !rootExceptions.includes(require('path').basename(n.path).toLowerCase())
    );

    if (unexpectedRoot.length > 0) {
      this.issues.push({
        severity:       'medium',
        category:       'organisation',
        issue:          'Notes at vault root',
        detail:         `${unexpectedRoot.length} notes with no folder: ` +
                        unexpectedRoot.slice(0, 5).map(n => n.path).join(', ') +
                        (unexpectedRoot.length > 5 ? '...' : ''),
        recommendation: 'Move all notes into appropriate folders'
      });
    }
  }

  _analyzeStructuralIssues() {
    const canonicalFolders = getCanonicalFolders(this.config).map(f => f.toLowerCase());

    // Notes in non-canonical folders
    const nonCanonical = [];
    for (const note of this.notes) {
      if (!note.path.includes('/')) continue; // root-level handled in _analyzeOrphans
      const top = note.path.split('/')[0].toLowerCase();
      if (!canonicalFolders.includes(top)) {
        nonCanonical.push(note.path);
      }
    }

    if (nonCanonical.length > 0) {
      // Deduplicate by top-level folder
      const nonCanonicalFolders = [...new Set(nonCanonical.map(p => p.split('/')[0]))];
      this.issues.push({
        severity:       'medium',
        category:       'structure',
        issue:          'Notes in non-canonical folders',
        detail:         `${nonCanonical.length} notes in non-canonical folders: ${nonCanonicalFolders.slice(0, 5).join(', ')}`,
        recommendation: 'Move notes to canonical folders or add these to customFolders in config'
      });
    }

    // Partially populated methodology folders
    if (this.detectedMethodology && this.detectedMethodology.confidence !== 'low') {
      const method = this.detectedMethodology.method;
      if (method.folders) {
        const emptyCorefolders = method.folders.filter(f => {
          const allNotes = this.notes.filter(n => n.path.startsWith(f + '/'));
          return this.folders.has(f) || allNotes.length > 0 ? allNotes.length <= 1 : false;
        });

        if (emptyCorefolders.length > 0) {
          this.issues.push({
            severity:       'high',
            category:       'methodology',
            issue:          `${method.name} folders mostly empty`,
            detail:         `Core folders with ≤1 note: ${emptyCorefolders.join(', ')}`,
            recommendation: `Either commit to ${method.name} by populating folders, or switch to a different system`
          });
        }
      }
    }
  }

  _generateRecommendations() {
    const total = this.notes.length;

    if (total < 50) {
      this.recommendations.push({
        priority:  'high',
        category:  'methodology',
        title:     'Keep it simple for now',
        detail:    'With <50 notes, focus on capturing and basic organisation. ' +
                   'Choose a methodology once you hit 100+ notes.',
        action:    'Use inbox + 3-5 broad categories for now'
      });
    } else if (!this.detectedMethodology || this.detectedMethodology.confidence === 'low') {
      this.recommendations.push({
        priority:  'high',
        category:  'methodology',
        title:     'Choose an organisational system',
        detail:    'No clear methodology detected. Popular options:\n' +
                   '• PARA: for actionable, project-focused work\n' +
                   '• Zettelkasten: for research and interconnected thinking\n' +
                   '• ACCESS: for PKM with MOCs',
        action:    'Review methodologies and commit to one'
      });
    }

    if (this.detectedMethodology && this.detectedMethodology.confidence === 'medium') {
      this.recommendations.push({
        priority:  'medium',
        category:  'methodology',
        title:     `Complete ${this.detectedMethodology.method.name} structure`,
        detail:    `Detected partial ${this.detectedMethodology.method.name} (${this.detectedMethodology.matches}/${this.detectedMethodology.total} folders).`,
        action:    'Create missing folders and establish filing rules'
      });
    }

    const inboxFolder   = (this.config.structure && this.config.structure.folders && this.config.structure.folders.inbox) || 'inbox';
    const inboxCount    = (this.folders.get(inboxFolder) || []).length;
    const reviewQueue   = (this.folders.get(`${inboxFolder}/review-queue`) || []).length;
    const totalInbox    = inboxCount + reviewQueue;

    if (totalInbox > 10) {
      this.recommendations.push({
        priority:  'high',
        category:  'workflow',
        title:     'Process inbox regularly',
        detail:    `${totalInbox} notes in inbox areas. Aim for inbox zero weekly.`,
        action:    'Use `obsidian-curator process` + `obsidian-curator file`'
      });
    }

    if (total > 30) {
      this.recommendations.push({
        priority:  'medium',
        category:  'automation',
        title:     'Enable automated filing',
        detail:    'Vault size supports AI-assisted organisation',
        action:    'Configure an AI provider and run `obsidian-curator file`'
      });
    }
  }

  _generateReport() {
    const severityOrder  = { high: 0, medium: 1, low: 2 };
    const priorityOrder  = { high: 0, medium: 1, low: 2 };

    return {
      summary: {
        totalNotes:             this.notes.length,
        totalFolders:           this.folders.size,
        detectedMethodology:    this.detectedMethodology,
        issuesCount:            this.issues.length,
        recommendationsCount:   this.recommendations.length
      },
      issues:          this.issues.sort((a, b) => (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2)),
      recommendations: this.recommendations.sort((a, b) => (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2)),
      structure:       this._getStructureOverview()
    };
  }

  _getStructureOverview() {
    const topFolders = Array.from(this.folders.entries())
      .filter(([f]) => !f.includes('/'))
      .map(([folder, notes]) => {
        const allNotes  = this.notes.filter(n => n.path.startsWith(folder + '/'));
        return {
          folder,
          count:      notes.length,
          total:      allNotes.length,
          percentage: (allNotes.length / (this.notes.length || 1) * 100).toFixed(1)
        };
      })
      .sort((a, b) => b.total - a.total);

    const nestedFolders = Array.from(this.folders.entries())
      .filter(([f]) => f.includes('/'))
      .map(([folder, notes]) => ({ folder, depth: folder.split('/').length, count: notes.length }))
      .sort((a, b) => a.depth - b.depth || b.count - a.count);

    const maxDepth = this.folders.size > 0
      ? Math.max(...Array.from(this.folders.keys()).map(f => f.split('/').length))
      : 0;

    return { topLevel: topFolders, nested: nestedFolders, maxDepth };
  }
}

module.exports = { StructureAuditor, METHODOLOGIES };
