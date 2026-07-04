#!/usr/bin/env node
/**
 * Backfill `issues.rank` (fractional-indexing) per (project_id, status) column.
 *
 * Ordering source: existing `position ASC` (legacy), then `created_at ASC` as
 * tiebreaker. Assigns a strictly increasing rank per column so the board keeps
 * its current visual order after switching ORDER BY to `rank`.
 *
 * SAFE-BY-DEFAULT: dry-run unless APPLY=1 is set. Never run against prod
 * without a backup + verified staging pass.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node backend/scripts/backfill-ranks.mjs          # dry-run
 *   DATABASE_URL=postgres://... APPLY=1 node backend/scripts/backfill-ranks.mjs   # writes
 *
 * Deps: pg, fractional-indexing (installed in frontend; run from repo root or
 * install locally: `npm i pg fractional-indexing`).
 */
import pg from 'pg';
import { generateNKeysBetween } from 'fractional-indexing';

const { DATABASE_URL, APPLY } = process.env;
if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}
const apply = APPLY === '1';

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();

try {
  // Only backfill rows that don't already have a rank.
  const { rows } = await client.query(
    `SELECT id, project_id, status, position, created_at
       FROM issues
      WHERE rank IS NULL
      ORDER BY project_id, status, position ASC NULLS LAST, created_at ASC`,
  );

  // Group by (project_id, status).
  const cols = new Map();
  for (const r of rows) {
    const key = `${r.project_id}::${r.status}`;
    if (!cols.has(key)) cols.set(key, []);
    cols.get(key).push(r);
  }

  let total = 0;
  await client.query('BEGIN');
  for (const [key, issues] of cols) {
    const keys = generateNKeysBetween(null, null, issues.length);
    for (let i = 0; i < issues.length; i++) {
      total++;
      if (apply) {
        await client.query('UPDATE issues SET rank = $1 WHERE id = $2', [keys[i], issues[i].id]);
      }
    }
    console.log(`${key}: ${issues.length} rows`);
  }
  if (apply) {
    await client.query('COMMIT');
    console.log(`APPLIED: ${total} rows ranked.`);
  } else {
    await client.query('ROLLBACK');
    console.log(`DRY-RUN: would rank ${total} rows. Set APPLY=1 to write.`);
  }

  const { rows: check } = await client.query('SELECT count(*)::int AS n FROM issues WHERE rank IS NULL');
  console.log(`Remaining NULL ranks: ${check[0].n}${apply ? '' : ' (unchanged, dry-run)'}`);
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Backfill failed:', e);
  process.exitCode = 1;
} finally {
  await client.end();
}
