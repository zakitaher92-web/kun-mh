'use strict';
// Sets On AVL = Y for every vendor. Vendors no longer need approval before they are used.
// Usage (in the server folder; set DATABASE_URL or the DB_* settings first):
//   npm run vendors:avl -- --dry-run   shows how many vendors would change; saves nothing
//   npm run vendors:avl                saves the change, in one transaction
const { createPool } = require('./db');

// Returns the vendor rows with every vendor marked approved, and how many changed.
function setAllAvl(rows) {
  const out = {};
  let changed = 0;
  for (const [key, entry] of Object.entries(rows || {})) {
    const r = { ...((entry && entry.r) || {}) };
    if (r.avl !== 'Y') { r.avl = 'Y'; changed++; }
    out[key] = { ...entry, r };
  }
  return { rows: out, changed, total: Object.keys(out).length };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query("SELECT data FROM kv_docs WHERE coll = 'm_vendors' AND id = 'all' FOR UPDATE");
    if (!rows.length) { await client.query('ROLLBACK'); console.log('No vendor list found; nothing to change.'); return; }
    const result = setAllAvl(rows[0].data.rows);
    console.log(`Vendors: ${result.total}; to change to AVL = Y: ${result.changed}`);
    if (dryRun) { await client.query('ROLLBACK'); console.log('Dry run: nothing saved.'); return; }
    await client.query(
      "UPDATE kv_docs SET data = $1::jsonb, updated_by = 'vendors-avl', updated_at = now() WHERE coll = 'm_vendors' AND id = 'all'",
      [JSON.stringify({ ...rows[0].data, rows: result.rows })]);
    await client.query('COMMIT');
    console.log('Saved. Every vendor is now approved.');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => { });
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(e => { console.error('Vendor update failed, nothing was saved:', e.message); process.exit(1); });
}
module.exports = { setAllAvl };
