'use strict';
// Loads the master data written by export-masters.js into THIS database (INSTALLATION_GUIDE.md, Part 7).
// Usage (in the server folder, with the app stopped):
//   npm run masters:import -- ..\dist\KUN-MH-masters-1.9.json --dry-run    (shows what would change, changes nothing)
//   npm run masters:import -- ..\dist\KUN-MH-masters-1.9.json              (applies the change, in one transaction)
//
// Only the master documents listed below are written. Transactions are never touched.
// Kept from this database: the approval passphrase, the lock state and the occupancy plan of the settings,
// and the password fields of users.
const fs = require('fs');
const { createPool } = require('./db');

const ALLOWED = new Set([
  'cfg/access', 'cfg/budgetLines', 'cfg/categories', 'cfg/lists', 'cfg/mpl', 'cfg/settings',
  'm_items/all', 'm_vendors/all', 'm_users/all',
]);
const KEEP_SETTINGS = ['approvalHash', 'locked', 'occupancy'];
const KEEP_USER_FIELDS = ['hash', 'salt'];

function load(file) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (doc.format !== 'kun-mh-masters' || doc.version !== 1 || !Array.isArray(doc.docs)) {
    throw new Error('This file is not a KUN MH master-data file (format kun-mh-masters, version 1).');
  }
  for (const d of doc.docs) {
    if (!ALLOWED.has(`${d.coll}/${d.id}`)) throw new Error(`Document not allowed in a master file: ${d.coll}/${d.id}`);
    if (!d.data || typeof d.data !== 'object') throw new Error(`No data in ${d.coll}/${d.id}`);
  }
  return doc;
}

// Builds the document to store: the file's content, with the values this database must keep.
function merge(coll, id, incoming, existing) {
  if (!existing) return incoming;
  const out = JSON.parse(JSON.stringify(incoming));
  if (coll === 'cfg' && id === 'settings' && existing.v && out.v) {
    KEEP_SETTINGS.forEach(k => { if (k in existing.v) out.v[k] = existing.v[k]; });
  }
  if (coll === 'm_users' && existing.rows && out.rows) {
    for (const [key, row] of Object.entries(out.rows)) {
      const old = existing.rows[key];
      if (old && old.r && row && row.r) KEEP_USER_FIELDS.forEach(k => { if (k in old.r) row.r[k] = old.r[k]; });
    }
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const file = args.find(a => !a.startsWith('--'));
  if (!file) { console.error('Usage: npm run masters:import -- <file.json> [--dry-run]'); process.exit(1); }
  const master = load(file);
  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log(dryRun ? 'DRY RUN - nothing will be saved' : 'Saving master data in one transaction');
    for (const d of master.docs) {
      const { rows } = await client.query('SELECT data FROM kv_docs WHERE coll = $1 AND id = $2 FOR UPDATE', [d.coll, d.id]);
      const existing = rows.length ? rows[0].data : null;
      const next = merge(d.coll, d.id, d.data, existing);
      const same = existing && (await client.query('SELECT $1::jsonb = $2::jsonb AS same', [existing, next])).rows[0].same;
      const state = !existing ? 'new' : same ? 'unchanged' : 'changed';
      console.log(`  ${state.padEnd(10)} ${d.coll}/${d.id}`);
      if (!same) {
        await client.query(
          `INSERT INTO kv_docs (coll, id, data, updated_by) VALUES ($1, $2, $3::jsonb, 'master-import')
           ON CONFLICT (coll, id) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [d.coll, d.id, JSON.stringify(next)]);
      }
    }
    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('Dry run finished. Nothing was saved. Run again without --dry-run to apply.');
    } else {
      await client.query('COMMIT');
      console.log('Master data saved. Check the screens in the app (INSTALLATION_GUIDE.md, Part 7, step 6).');
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => { });
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error('Import failed, nothing was saved:', e.message); process.exit(1); });
