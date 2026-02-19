/**
 * Processor - Main module for processing inbox notes
 * Scans, analyzes, and updates notes with AI suggestions
 */

const VaultClient = require('./vault-client');
const { analyzeNote } = require('./ai-client');
const loadConfig = require('./config');
const fs = require('fs');
const path = require('path');

/**
 * Process inbox notes with AI analysis
 * @param {Object} options - Processing options
 * @param {number} options.limit - Max notes to process (default: 10)
 * @param {string} options.model - AI model to use (default: qwen2.5-coder:7b)
 * @param {boolean} options.dryRun - If true, don't write changes (default: false)
 * @param {boolean} options.force - Process even if already processed (default: false)
 * @returns {Promise<Object>} Results summary
 */
async function processInbox(options = {}) {
  const config = loadConfig();
  const {
    limit = config.processor.defaultLimit,
    model = config.processor.defaultModel,
    dryRun = false,
    force = false
  } = options;
  
  const vaultClient = new VaultClient(config.couchdb);
  
  console.log('🔍 Scanning inbox for unprocessed notes...');
  
  // List all notes
  const allNotes = await vaultClient.listNotes();
  
  // Filter inbox notes
  const inboxNotes = allNotes.filter(note => 
    note.path.startsWith(config.inbox.path)
  );
  
  console.log(`Found ${inboxNotes.length} notes in inbox`);
  
  // Load vault structure
  const vaultStructure = await loadVaultStructure(vaultClient, config);
  
  // Process notes
  const results = {
    processed: 0,
    skipped: 0,
    failed: 0,
    notes: []
  };
  
  let processed = 0;
  
  for (const noteInfo of inboxNotes) {
    if (processed >= limit) {
      console.log(`Reached limit of ${limit} notes`);
      break;
    }
    
    try {
      // Read full note content
      const note = await vaultClient.readNote(noteInfo.path);
      
      if (!note) {
        console.log(`⚠️  Could not read note: ${noteInfo.path}`);
        results.skipped++;
        continue;
      }
      
      // Parse frontmatter
      const { frontmatter, body } = vaultClient.parseFrontmatter(note.content);
      
      // Check if already processed
      if (frontmatter.processed && !force) {
        console.log(`⏭️  Skipping already processed: ${noteInfo.path}`);
        results.skipped++;
        continue;
      }
      
      console.log(`\n📝 Processing: ${noteInfo.path}`);
      
      // Analyze with AI
      const analysis = await analyzeNote(
        { path: note.path, body, frontmatter },
        vaultStructure,
        model
      );
      
      console.log(`   📊 Analysis: ${analysis.confidence} confidence`);
      console.log(`   📁 Folder: ${analysis.folder}`);
      console.log(`   🏷️  Tags: ${analysis.tags.join(', ')}`);
      
      // Update frontmatter with suggestions
      const updatedFrontmatter = {
        ...frontmatter,
        processed: true,
        processed_at: new Date().toISOString(),
        ai_suggestions: {
          folder: analysis.folder,
          tags: analysis.tags,
          related: analysis.related || [],
          summary: analysis.summary,
          confidence: analysis.confidence
        }
      };
      
      // Rebuild note
      const updatedContent = vaultClient.buildNote(updatedFrontmatter, body);
      
      // Write back to vault (unless dry run)
      if (!dryRun) {
        await vaultClient.writeNote(note.path, updatedContent);
        console.log(`   ✅ Updated with suggestions`);
      } else {
        console.log(`   [DRY RUN] Would update with suggestions`);
      }
      
      results.processed++;
      results.notes.push({
        path: note.path,
        analysis,
        status: 'success'
      });
      
      processed++;
      
    } catch (err) {
      console.error(`❌ Error processing ${noteInfo.path}:`, err.message);
      results.failed++;
      results.notes.push({
        path: noteInfo.path,
        error: err.message,
        status: 'failed'
      });
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 Processing Summary:');
  console.log(`   ✅ Processed: ${results.processed}`);
  console.log(`   ⏭️  Skipped: ${results.skipped}`);
  console.log(`   ❌ Failed: ${results.failed}`);
  console.log('='.repeat(50));
  
  return results;
}

/**
 * Load vault structure from cache or generate it
 * @param {VaultClient} vaultClient - Vault client instance
 * @param {Object} config - Configuration object
 * @returns {Promise<Object>} Vault structure
 */
async function loadVaultStructure(vaultClient, config) {
  const cachePath = config.processor.vaultStructureCachePath;
  const maxAge = config.processor.vaultStructureMaxAge;
  
  // Check if cache exists and is fresh
  if (fs.existsSync(cachePath)) {
    const stats = fs.statSync(cachePath);
    const age = Date.now() - stats.mtimeMs;
    
    if (age < maxAge) {
      console.log('📦 Loading vault structure from cache');
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      return cached;
    }
  }
  
  console.log('🔄 Generating vault structure...');
  
  // Generate structure
  const allNotes = await vaultClient.listNotes();
  
  // Extract folders
  const folderCounts = {};
  const tagCounts = {};
  
  for (const note of allNotes) {
    // Count folders
    const folderPath = path.dirname(note.path);
    if (folderPath && folderPath !== '.') {
      folderCounts[folderPath] = (folderCounts[folderPath] || 0) + 1;
    }
    
    // Count tags (we'd need to read each note for tags, skip for now to save time)
    // In production, you might want to cache tags separately
  }
  
  const structure = {
    folders: Object.entries(folderCounts)
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count),
    tags: tagCounts,
    noteCount: allNotes.length,
    updated: new Date().toISOString()
  };
  
  // Save to cache
  fs.writeFileSync(cachePath, JSON.stringify(structure, null, 2));
  console.log(`✅ Cached vault structure (${structure.folders.length} folders, ${structure.noteCount} notes)`);
  
  return structure;
}

/**
 * Refresh vault structure cache
 * @returns {Promise<Object>} Updated vault structure
 */
async function refreshVaultStructure() {
  const config = loadConfig();
  const vaultClient = new VaultClient(config.couchdb);
  
  // Delete cache to force refresh
  const cachePath = config.processor.vaultStructureCachePath;
  if (fs.existsSync(cachePath)) {
    fs.unlinkSync(cachePath);
  }
  
  return await loadVaultStructure(vaultClient, config);
}

module.exports = {
  processInbox,
  refreshVaultStructure
};
