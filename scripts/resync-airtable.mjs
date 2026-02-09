#!/usr/bin/env node
/**
 * Resync Airtable data into Baaton Supabase DB.
 * Matches issues by title, then syncs:
 *  - Type array → tags
 *  - Commentaires → TLDR records  
 *  - PJ attachments → attachments JSONB
 *  - Priorité → priority mapping
 * Also ensures project_tags for FRONT/BACK/API/DB exist.
 */

const AIRTABLE_TOKEN = 'patkIXXWOuZuUj1Rg.823f32d588c361d3ba8aac3eae5ca2aa59e40097b64510545be06c027da59f3d';
const AIRTABLE_BASE = 'appwbIveN17qHssIe';
const AIRTABLE_TABLE = 'tblXNYMfwam5qXNkI';

const DATABASE_URL = 'postgresql://postgres.qkxamgohklyrgglggjaz:ybj4XMF.etv5xhv%2Advg@aws-1-eu-west-1.pooler.supabase.com:5432/postgres';

const PRIORITY_MAP = {
  '⚡ Urgent': 'urgent',
  '🔴 Haute': 'high',
  '🟡 Normale': 'medium',
  '🟢 Basse': 'low',
};

const TAG_COLORS = {
  FRONT: '#3b82f6',
  BACK: '#22c55e',
  API: '#8b5cf6',
  DB: '#f97316',
};

// Fetch all Airtable records with pagination
async function fetchAllRecords() {
  const records = [];
  let offset = null;
  
  do {
    const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}`);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);

    const res = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` },
    });
    const data = await res.json();
    
    if (data.records) records.push(...data.records);
    offset = data.offset || null;
    
    console.log(`  Fetched ${records.length} records...`);
    if (offset) await new Promise(r => setTimeout(r, 200)); // rate limit
  } while (offset);

  return records;
}

// Use pg module
async function main() {
  let pg;
  try {
    pg = await import('pg');
  } catch {
    console.log('Installing pg...');
    const { execSync } = await import('child_process');
    execSync('npm install pg', { stdio: 'inherit', cwd: '/tmp' });
    pg = await import('pg');
  }

  const { Client } = pg.default || pg;

  console.log('=== Baaton Airtable Resync ===\n');

  // 1. Fetch Airtable
  console.log('1. Fetching Airtable records...');
  const records = await fetchAllRecords();
  console.log(`   Total: ${records.length} records\n`);

  // 2. Connect to DB
  console.log('2. Connecting to Supabase...');
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log('   Connected!\n');

  // 3. Get all projects
  const { rows: projects } = await client.query('SELECT id, name FROM projects');
  console.log(`   Found ${projects.length} projects\n`);

  // 4. Ensure project_tags exist
  console.log('3. Ensuring project_tags (FRONT/BACK/API/DB)...');
  for (const project of projects) {
    for (const [tagName, tagColor] of Object.entries(TAG_COLORS)) {
      await client.query(
        `INSERT INTO project_tags (project_id, name, color) 
         VALUES ($1, $2, $3) 
         ON CONFLICT (project_id, name) DO UPDATE SET color = $3`,
        [project.id, tagName, tagColor]
      );
    }
  }
  console.log('   Done!\n');

  // 5. Process each record
  console.log('4. Syncing records...');
  let updated = 0, tldrsCreated = 0, attachmentsSynced = 0, skipped = 0;

  for (const record of records) {
    const f = record.fields;
    const title = f['Nom'];
    if (!title) { skipped++; continue; }

    // Find matching issue by title
    const { rows: issues } = await client.query(
      'SELECT id, project_id FROM issues WHERE title = $1 LIMIT 1',
      [title]
    );
    if (issues.length === 0) { skipped++; continue; }
    
    const issue = issues[0];
    const updates = {};

    // Tags from Type
    const types = f['Type'] || [];
    if (types.length > 0) {
      await client.query(
        'UPDATE issues SET tags = $1, category = $1 WHERE id = $2',
        [types, issue.id]
      );
    }

    // Priority
    const prioriteRaw = f['Priorité'] || '';
    const priority = PRIORITY_MAP[prioriteRaw];
    if (priority) {
      await client.query(
        'UPDATE issues SET priority = $1 WHERE id = $2',
        [priority, issue.id]
      );
    }

    // Attachments from PJ
    const pj = f['PJ'] || [];
    if (pj.length > 0) {
      const attachments = pj.map(a => ({
        url: a.url,
        name: a.filename || 'attachment',
        size: a.size || 0,
        mime_type: a.type || 'application/octet-stream',
      }));
      await client.query(
        'UPDATE issues SET attachments = $1::jsonb WHERE id = $2',
        [JSON.stringify(attachments), issue.id]
      );
      attachmentsSynced += pj.length;
    }

    // Comments/TLDRs
    const comments = f['Commentaires'] || '';
    if (comments.trim()) {
      // Check if TLDR already exists
      const { rows: existing } = await client.query(
        "SELECT id FROM tldrs WHERE issue_id = $1 AND agent_name = 'airtable-import' LIMIT 1",
        [issue.id]
      );
      if (existing.length === 0) {
        await client.query(
          `INSERT INTO tldrs (issue_id, agent_name, summary, files_changed, tests_status)
           VALUES ($1, 'airtable-import', $2, '{}', 'none')`,
          [issue.id, comments.trim()]
        );
        tldrsCreated++;
      }
    }

    updated++;
  }

  await client.end();

  console.log('\n=== RESYNC COMPLETE ===');
  console.log(`  Updated: ${updated} issues`);
  console.log(`  TLDRs created: ${tldrsCreated}`);
  console.log(`  Attachments synced: ${attachmentsSynced}`);
  console.log(`  Skipped: ${skipped} (no title or no match)`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
