#!/usr/bin/env node
/**
 * Vault Structure Auditor
 * 
 * Analyzes Obsidian vault organization and provides recommendations
 * based on best practices (PARA, Zettelkasten, Johnny Decimal).
 */

const VaultClient = require('./vault-client');

// Known organizational methodologies
const METHODOLOGIES = {
  PARA: {
    name: 'PARA (Projects, Areas, Resources, Archives)',
    folders: ['Projects', 'Areas', 'Resources', 'Archives'],
    description: 'Actionability-based organization by Tiago Forte',
    idealFor: 'Goal-oriented work, GTD practitioners, actionable knowledge',
    rules: {
      maxDepth: 2,
      requireFolders: ['Projects', 'Areas', 'Resources', 'Archives'],
      allowedAtRoot: ['inbox', 'Templates', 'Attachments']
    }
  },
  
  Zettelkasten: {
    name: 'Zettelkasten (Slip-box)',
    folders: ['Slipbox', 'Literature', 'Fleeting', 'Permanent'],
    description: 'Atomic note-taking with heavy linking',
    idealFor: 'Research, writing, interconnected thinking',
    rules: {
      maxDepth: 1,
      preferFlat: true,
      requireBacklinks: true,
      allowedAtRoot: ['inbox', 'Slipbox', 'Literature', 'Fleeting', 'Permanent', 'Templates']
    }
  },
  
  ACCESS: {
    name: 'ACCESS (Atlas, Calendar, Cards, Extras, Sources, Spaces)',
    folders: ['Atlas', 'Calendar', 'Cards', 'Extras', 'Sources', 'Spaces'],
    description: 'Nick Milo\'s Linking Your Thinking system',
    idealFor: 'PKM enthusiasts, MOC-heavy workflows',
    rules: {
      maxDepth: 2,
      requireFolders: ['Atlas', 'Calendar', 'Cards', 'Sources', 'Spaces'],
      allowedAtRoot: ['inbox', 'Templates', 'Attachments']
    }
  },
  
  JohnnyDecimal: {
    name: 'Johnny Decimal',
    pattern: /^\d{2}\.\d{2}/,
    description: 'Numeric categorization (10.00-99.99)',
    idealFor: 'Structured thinking, archive/reference material',
    rules: {
      maxDepth: 2,
      requireNumericPrefix: true,
      maxCategories: 10
    }
  }
};

class StructureAuditor {
  constructor(vaultClient) {
    this.vault = vaultClient;
    this.notes = [];
    this.folders = new Map();
    this.issues = [];
    this.recommendations = [];
    this.detectedMethodology = null;
  }
  
  async analyze() {
    // Load vault data
    await this.loadVaultData();
    
    // Run analysis
    this.detectMethodology();
    this.analyzeDepth();
    this.analyzeDistribution();
    this.analyzeNaming();
    this.analyzeOrphans();
    this.analyzeStructuralIssues();
    
    // Generate recommendations
    this.generateRecommendations();
    
    return this.generateReport();
  }
  
  async loadVaultData() {
    this.notes = await this.vault.listNotes();
    
    // Build folder map
    this.notes.forEach(note => {
      const parts = note.path.split('/');
      if (parts.length > 1) {
        const folder = parts.slice(0, -1).join('/');
        if (!this.folders.has(folder)) {
          this.folders.set(folder, []);
        }
        this.folders.get(folder).push(note);
      }
    });
  }
  
  detectMethodology() {
    const topFolders = Array.from(this.folders.keys())
      .filter(f => !f.includes('/'))
      .map(f => f.toLowerCase());
    
    let scores = {};
    
    // Score each methodology
    for (const [key, method] of Object.entries(METHODOLOGIES)) {
      if (!method.folders) continue;
      
      const matches = method.folders.filter(f => 
        topFolders.includes(f.toLowerCase())
      ).length;
      
      scores[key] = {
        matches,
        total: method.folders.length,
        percentage: (matches / method.folders.length) * 100,
        method
      };
    }
    
    // Find best match
    const best = Object.entries(scores)
      .sort((a, b) => b[1].percentage - a[1].percentage)[0];
    
    if (best && best[1].percentage >= 25) {
      this.detectedMethodology = {
        type: best[0],
        ...best[1],
        confidence: best[1].percentage >= 75 ? 'high' : 
                   best[1].percentage >= 50 ? 'medium' : 'low'
      };
    }
    
    // Check for mixed methodologies
    const multiplePartial = Object.values(scores)
      .filter(s => s.percentage > 0 && s.percentage < 75);
    
    if (multiplePartial.length > 1) {
      this.issues.push({
        severity: 'medium',
        category: 'methodology',
        issue: 'Mixed methodology detected',
        detail: `Found elements of ${multiplePartial.length} different systems: ` +
                multiplePartial.map(s => s.method.name).join(', '),
        recommendation: 'Choose one methodology and commit to it fully'
      });
    }
  }
  
  analyzeDepth() {
    const depthMap = new Map();
    
    this.folders.forEach((notes, folder) => {
      const depth = folder.split('/').length;
      if (!depthMap.has(depth)) {
        depthMap.set(depth, []);
      }
      depthMap.get(depth).push({ folder, count: notes.length });
    });
    
    const maxDepth = Math.max(...depthMap.keys());
    const recommendedMax = this.detectedMethodology?.method.rules.maxDepth || 3;
    
    if (maxDepth > recommendedMax) {
      const deepFolders = Array.from(this.folders.entries())
        .filter(([folder]) => folder.split('/').length > recommendedMax)
        .map(([folder, notes]) => ({ folder, count: notes.length }));
      
      this.issues.push({
        severity: 'low',
        category: 'depth',
        issue: `Folder nesting too deep (max: ${maxDepth}, recommended: ${recommendedMax})`,
        detail: `Deep folders: ${deepFolders.map(f => f.folder).join(', ')}`,
        recommendation: 'Flatten hierarchy or consolidate nested folders'
      });
    }
  }
  
  analyzeDistribution() {
    const total = this.notes.length;
    const folderStats = Array.from(this.folders.entries())
      .map(([folder, notes]) => ({
        folder,
        count: notes.length,
        percentage: (notes.length / total) * 100
      }))
      .sort((a, b) => b.count - a.count);
    
    // Check for working folder dominance
    const workingFolders = ['inbox', 'drafts', 'temp', 'scratch'];
    const workingNotes = folderStats
      .filter(f => workingFolders.some(w => f.folder.toLowerCase().includes(w)))
      .reduce((sum, f) => sum + f.count, 0);
    
    const workingPercentage = (workingNotes / total) * 100;
    
    if (workingPercentage > 40) {
      this.issues.push({
        severity: 'high',
        category: 'distribution',
        issue: 'Too many notes in working folders',
        detail: `${workingNotes}/${total} notes (${workingPercentage.toFixed(1)}%) in inbox/temp areas`,
        recommendation: 'Process and file notes regularly; consider automated filing'
      });
    }
    
    // Check for single-note folders (top-level only, with recursive counting)
    const topLevelFolders = Array.from(this.folders.keys())
      .filter(f => !f.includes('/'));
    
    const singleNoteFolders = topLevelFolders.filter(folder => {
      // Count all notes in this folder and subfolders (recursive)
      const allNotes = this.notes.filter(n => n.path.startsWith(folder + '/'));
      return allNotes.length === 1;
    });
    
    if (singleNoteFolders.length > 3) {
      this.issues.push({
        severity: 'medium',
        category: 'distribution',
        issue: 'Many single-note folders (structural orphans)',
        detail: `${singleNoteFolders.length} folders with only 1 note: ` +
                singleNoteFolders.slice(0, 5).join(', ') +
                (singleNoteFolders.length > 5 ? '...' : ''),
        recommendation: 'Consolidate related folders or move notes to more populated areas'
      });
    }
  }
  
  analyzeNaming() {
    const topFolders = Array.from(this.folders.keys())
      .filter(f => !f.includes('/'));
    
    // Check for unclear names
    const vagueNames = topFolders.filter(f => 
      f.toLowerCase().match(/^(misc|other|stuff|things|notes|general|random)$/i)
    );
    
    if (vagueNames.length > 0) {
      this.issues.push({
        severity: 'low',
        category: 'naming',
        issue: 'Vague folder names',
        detail: `Unclear folders: ${vagueNames.join(', ')}`,
        recommendation: 'Use specific, descriptive names that indicate content'
      });
    }
    
    // Check for case inconsistency
    const casePatterns = topFolders.map(f => {
      if (f === f.toLowerCase()) return 'lower';
      if (f === f.toUpperCase()) return 'upper';
      if (f[0] === f[0].toUpperCase()) return 'title';
      return 'mixed';
    });
    
    const uniquePatterns = [...new Set(casePatterns)];
    if (uniquePatterns.length > 1) {
      this.issues.push({
        severity: 'low',
        category: 'naming',
        issue: 'Inconsistent capitalization',
        detail: `Mix of ${uniquePatterns.join(', ')} case in folder names`,
        recommendation: 'Standardize on Title Case or lowercase throughout'
      });
    }
  }
  
  analyzeOrphans() {
    // Notes at root level (no folder)
    const rootNotes = this.notes.filter(n => !n.path.includes('/'));
    
    if (rootNotes.length > 0) {
      this.issues.push({
        severity: 'medium',
        category: 'organization',
        issue: 'Notes at vault root',
        detail: `${rootNotes.length} notes with no folder: ` +
                rootNotes.slice(0, 5).map(n => n.path).join(', ') +
                (rootNotes.length > 5 ? '...' : ''),
        recommendation: 'Move all notes into appropriate folders'
      });
    }
  }
  
  analyzeStructuralIssues() {
    // Check if methodology folders exist but are empty/near-empty
    // Only warn if confidence is medium or high (intentional partial use is ok at low confidence)
    if (this.detectedMethodology && this.detectedMethodology.confidence !== 'low') {
      const method = this.detectedMethodology.method;
      
      if (method.folders) {
        // Only check folders that actually exist
        const emptyCore = method.folders.filter(f => {
          const allNotes = this.notes.filter(n => n.path.startsWith(f + '/'));
          // Folder exists (has at least the folder structure) but has ≤1 note
          const folderExists = this.folders.has(f) || allNotes.length > 0;
          return folderExists && allNotes.length <= 1;
        });
        
        if (emptyCore.length > 0) {
          this.issues.push({
            severity: 'high',
            category: 'methodology',
            issue: `${method.name} folders mostly empty`,
            detail: `Core folders with ≤1 note: ${emptyCore.join(', ')}`,
            recommendation: `Either commit to ${method.name} by populating folders, or switch to a different system`
          });
        }
      }
    }
  }
  
  generateRecommendations() {
    const total = this.notes.length;
    
    // Small vault recommendations
    if (total < 50) {
      this.recommendations.push({
        priority: 'high',
        category: 'methodology',
        title: 'Keep it simple for now',
        detail: 'With <50 notes, focus on capturing and basic organization. ' +
                'Choose a methodology once you hit 100+ notes.',
        action: 'Use inbox + 3-5 broad categories for now'
      });
    } else {
      // Methodology recommendation (only for larger vaults)
      if (!this.detectedMethodology || this.detectedMethodology.confidence === 'low') {
        this.recommendations.push({
          priority: 'high',
          category: 'methodology',
          title: 'Choose an organizational system',
          detail: 'No clear methodology detected. Popular options:\n' +
                  '• PARA: for actionable, project-focused work\n' +
                  '• Zettelkasten: for research and interconnected thinking\n' +
                  '• ACCESS: for PKM with MOCs',
          action: 'Review methodologies and commit to one'
        });
      }
    }
    
    // Partial methodology completion (any vault size)
    if (this.detectedMethodology && this.detectedMethodology.confidence === 'medium') {
      this.recommendations.push({
        priority: 'medium',
        category: 'methodology',
        title: `Complete ${this.detectedMethodology.method.name} structure`,
        detail: `Detected partial ${this.detectedMethodology.method.name} (${this.detectedMethodology.matches}/${this.detectedMethodology.total} folders). ` +
                'Commit fully or switch to a different system.',
        action: `Create missing folders and establish filing rules`
      });
    }
    
    // Process inbox
    const inboxCount = this.folders.get('inbox')?.length || 0;
    const reviewQueue = this.folders.get('inbox/review-queue')?.length || 0;
    const totalInbox = inboxCount + reviewQueue;
    
    if (totalInbox > 10) {
      this.recommendations.push({
        priority: 'high',
        category: 'workflow',
        title: 'Process inbox regularly',
        detail: `${totalInbox} notes in inbox areas. Aim for inbox zero weekly.`,
        action: 'Schedule weekly review; use /file command with automation'
      });
    }
    
    // Automation suggestions
    if (total > 30) {
      this.recommendations.push({
        priority: 'medium',
        category: 'automation',
        title: 'Enable automated filing',
        detail: 'Vault size supports AI-assisted organization',
        action: 'Use /file with lower confidence threshold (0.6) + review queue'
      });
    }
  }
  
  generateReport() {
    const report = {
      summary: {
        totalNotes: this.notes.length,
        totalFolders: this.folders.size,
        detectedMethodology: this.detectedMethodology,
        issuesCount: this.issues.length,
        recommendationsCount: this.recommendations.length
      },
      issues: this.issues.sort((a, b) => {
        const severityOrder = { high: 0, medium: 1, low: 2 };
        return severityOrder[a.severity] - severityOrder[b.severity];
      }),
      recommendations: this.recommendations.sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }),
      structure: this.getStructureOverview()
    };
    
    return report;
  }
  
  getStructureOverview() {
    // Calculate total notes (including nested) for each top-level folder
    const topFolders = Array.from(this.folders.entries())
      .filter(([folder]) => !folder.includes('/'))
      .map(([folder, notes]) => {
        // Count all notes in this folder and its subfolders
        const allNotes = this.notes.filter(n => n.path.startsWith(folder + '/'));
        const total = allNotes.length;
        
        return {
          folder,
          count: notes.length,  // Direct children only
          total: total,         // Including all nested
          percentage: (total / this.notes.length * 100).toFixed(1)
        };
      })
      .sort((a, b) => b.total - a.total);
    
    const nestedFolders = Array.from(this.folders.entries())
      .filter(([folder]) => folder.includes('/'))
      .map(([folder, notes]) => ({
        folder,
        depth: folder.split('/').length,
        count: notes.length
      }))
      .sort((a, b) => a.depth - b.depth || b.count - a.count);
    
    return {
      topLevel: topFolders,
      nested: nestedFolders,
      maxDepth: Math.max(...Array.from(this.folders.keys()).map(f => f.split('/').length))
    };
  }
}

// CLI usage
if (require.main === module) {
  const loadConfig = require('./config');
  const config = loadConfig();
  const client = new VaultClient(config.couchdb);
  const auditor = new StructureAuditor(client);
  
  auditor.analyze()
    .then(report => {
      console.log(JSON.stringify(report, null, 2));
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
}

module.exports = { StructureAuditor, METHODOLOGIES };
