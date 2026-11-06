'use strict';
// Writes the master data of this database to one JSON file, so that it can be loaded into another copy
// (see INSTALLATION_GUIDE.md, Part 7). Run it on the database that has the correct masters.
// Usage (in the server folder):  npm run masters:export -- ..\dist\KUN-MH-masters-1.9.json
//
// Exported: price list (MPL), budget lines, categories, lists, access rights, settings, items, vendors and users.
// NOT exported: transactions (POs, GRNs, bills, job cards, audit, notifications, number log, counters),
// room status (m_rooms), the lock state and the approval passphrase of the settings, and the password fields of users.
const fs = require('fs');
const path = require('path');
const { createPool } = require('./db');

const MASTERS = [
  ['cfg', 'access'], ['cfg', 'budgetLines'], ['cfg', 'categories'], ['cfg', 'lists'], ['cfg', 'mpl'],
  ['cfg', 'settings'], ['m_items', 'all'], ['m_vendors', 'all'], ['m_users', 'all'],
];
const SECRET_SETTINGS = ['approvalHash'];
const SECRET_USER_FIELDS = ['hash', 'salt'];

function stripSecrets(coll, id, data) {
  if (coll === 'cfg' && id === 'settings' && data.v) {
    SECRET_SETTINGS.forEach(k => delete data.v[k]);
  }
  if (coll === 'm_users' && data.rows) {
    for (const row of Object.values(data.rows)) {
      if (row && row.r) SECRET_USER_FIELDS.forEach(k => delete row.r[k]);
    }
  }
  return data;
}

async function main() {
  const out = process.argv[2];
  if (!out) { console.error('Usage: npm run masters:export -- <file.json>'); process.exit(1); }
  const pool = createPool();
  const docs = [];
  for (const [coll, id] of MASTERS) {
    const { rows } = await pool.query('SELECT data FROM kv_docs WHERE coll = $1 AND id = $2', [coll, id]);
    if (!rows.length) { console.warn(`Not in this database, skipped: ${coll}/${id}`); continue; }
    docs.push({ coll, id, data: stripSecrets(coll, id, rows[0].data) });
  }
  const file = {
    format: 'kun-mh-masters', version: 1, exportedAt: new Date().toISOString(), docs,
  };
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(file, null, 2), 'utf8');
  console.log(`Exported ${docs.length} master documents to ${path.resolve(out)}`);
  docs.forEach(d => console.log(`  ${d.coll}/${d.id}`));
  await pool.end();
}

main().catch(e => { console.error('Export failed:', e.message); process.exit(1); });
