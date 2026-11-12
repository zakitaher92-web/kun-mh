'use strict';
// Renames the vendors whose names are in Arabic to English (vendor-names-en.json), and changes every saved
// reference to the old name (POs, bills, MPL rows, advances, and any other document) in one transaction.
// Usage (in the server folder, with the app stopped):
//   npm run vendors:english -- --dry-run
//   npm run vendors:english -- --apply --backup ..\backup-vendors-before.json
// A backup of every document that will change is written before the change (--backup is required with --apply).
const fs = require('fs');
const path = require('path');
const { createPool } = require('./db');

const MAP = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vendor-names-en.json'), 'utf8'));
const ARABIC = /[؀-ۿ]/;

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const bi = args.indexOf('--backup');
  const backupFile = bi >= 0 ? args[bi + 1] : null;
  if (apply && !backupFile) { console.error('--apply needs --backup <file> so the old data can be restored.'); process.exit(1); }

  const pool = createPool();
  const client = await pool.connect();
  try {
    const { rows } = await client.query("SELECT data FROM kv_docs WHERE coll = 'm_vendors' AND id = 'all' FOR UPDATE");
    if (!rows.length) throw new Error('The vendor list (m_vendors/all) was not found.');
    const vendors = Object.values(rows[0].data.rows || {}).map(x => x.r);
    const taken = new Set(vendors.filter(v => !ARABIC.test(v.name || '')).map(v => v.name));
    const pairs = [];
    for (const [code, english] of Object.entries(MAP)) {
      if (code.startsWith('_')) continue;
      const v = vendors.find(x => x.code === code);
      if (!v) throw new Error(`Vendor ${code} is not in the vendor list.`);
      if (!ARABIC.test(v.name)) { console.log(`  skipped  ${code} already English: ${v.name}`); continue; }
      if (taken.has(english)) throw new Error(`The English name "${english}" is already used by another vendor.`);
      taken.add(english);
      pairs.push({ code, from: v.name, to: english });
    }
    const seen = new Set();
    for (const p of pairs) { if (seen.has(p.to)) throw new Error(`Two vendors would get the same name: ${p.to}`); seen.add(p.to); }
    console.log(`${apply ? 'APPLYING' : 'DRY RUN'}: ${pairs.length} vendor(s) to rename`);
    pairs.forEach(p => console.log(`  ${p.code}  ${p.from}  ->  ${p.to}`));
    if (!apply) { await client.query('ROLLBACK').catch(() => {}); return; }

    await client.query('BEGIN');
    const changed = [];
    for (const p of pairs) {
      const oldQ = JSON.stringify(p.from), newQ = JSON.stringify(p.to);
      const hits = await client.query('SELECT coll, id, data FROM kv_docs WHERE strpos(data::text, $1) > 0', [oldQ]);
      hits.rows.forEach(h => { if (!changed.find(c => c.coll === h.coll && c.id === h.id)) changed.push({ coll: h.coll, id: h.id, data: h.data }); });
      await client.query('UPDATE kv_docs SET data = replace(data::text, $1, $2)::jsonb, updated_by = $3, updated_at = now() WHERE strpos(data::text, $1) > 0',
        [oldQ, newQ, 'vendors-english']);
    }
    fs.writeFileSync(backupFile, JSON.stringify({ savedAt: new Date().toISOString(), docs: changed }, null, 2), 'utf8');
    console.log(`Documents changed: ${changed.length}. Backup: ${path.resolve(backupFile)}`);
    await client.query('COMMIT');
    console.log('Done. Vendor names are now in English.');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error('Vendor rename failed, nothing was saved:', e.message); process.exit(1); });
