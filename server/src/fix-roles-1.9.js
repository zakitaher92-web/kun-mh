'use strict';
// Sets the roles of four people that the 1.9 master file gave the Admin role by mistake:
// Sigat members (SIGAT1, SIGAT2) and Internal Auditors (TZAKI, TGHADIALI).
// Only a user whose role is still Admin is changed. Each change gets an audit-log entry.
// Usage (in the server folder, with the app stopped):
//   npm run roles:fix-1.9 -- --dry-run     (shows what would change, saves nothing)
//   npm run roles:fix-1.9                  (applies the change, in one transaction)
const { createPool } = require('./db');

const CHANGES = [
  { id: 'SIGAT1', role: 'Sigat' },
  { id: 'SIGAT2', role: 'Sigat' },
  { id: 'TZAKI', role: 'Internal Auditor' },
  { id: 'TGHADIALI', role: 'Internal Auditor' },
];
const ROLES = ['Admin', 'Sigat', 'Internal Auditor', 'Maintenance Masool', 'GRN Officer', 'HK Supervisor', 'Accounts'];
const pad = n => String(n).padStart(2, '0');
const stamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

// Changes the roles inside an open transaction. Returns what was changed and what was left alone.
async function applyRoles(client, changes = CHANGES, now = new Date()) {
  for (const c of changes) if (!ROLES.includes(c.role)) throw new Error(`Unknown role: ${c.role}`);
  const { rows } = await client.query("SELECT data FROM kv_docs WHERE coll = 'm_users' AND id = 'all' FOR UPDATE");
  if (!rows.length) throw new Error('The user list (m_users/all) was not found.');
  const doc = rows[0].data;
  const users = doc.rows || {};
  const changed = [], skipped = [];
  for (const c of changes) {
    const row = users[c.id];
    if (!row || !row.r) throw new Error(`User not found: ${c.id}`);
    if (row.r.role === c.role) { skipped.push(`${c.id} already ${c.role}`); continue; }
    if (row.r.role !== 'Admin') { skipped.push(`${c.id} has role "${row.r.role}" - not changed`); continue; }
    changed.push({ id: c.id, from: row.r.role, to: c.role, active: row.r.active });
    row.r.role = c.role;
  }
  if (changed.length) {
    await client.query(
      "UPDATE kv_docs SET data = $1::jsonb, updated_by = 'setup-roles-1.9', updated_at = now() WHERE coll = 'm_users' AND id = 'all'",
      [JSON.stringify(doc)]);
    await addAudit(client, changed, now);
  }
  return { changed, skipped };
}

// Adds one "User updated" entry per change to this month's audit log (same format as the app).
async function addAudit(client, changed, now) {
  const month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const { rows } = await client.query("SELECT data FROM kv_docs WHERE coll = 'm_audit' AND id = $1 FOR UPDATE", [month]);
  const doc = rows.length ? rows[0].data : { rows: {} };
  doc.rows = doc.rows || {};
  let order = Math.max(-1, ...Object.values(doc.rows).map(x => (x && typeof x.o === 'number' ? x.o : -1)));
  for (const c of changed) {
    order += 1;
    const key = `${stamp(now).replace(/\D/g, '')}-roles-${c.id}`;
    doc.rows[key] = {
      o: order,
      r: { k: key, t: stamp(now), user: 'Setup script (roles 1.9)', action: 'User updated',
        details: `${c.id} ${c.to} active ${c.active || 'Y'} (role was ${c.from})` },
    };
  }
  await client.query(
    `INSERT INTO kv_docs (coll, id, data, updated_by) VALUES ('m_audit', $1, $2::jsonb, 'setup-roles-1.9')
     ON CONFLICT (coll, id) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [month, JSON.stringify(doc)]);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log(dryRun ? 'DRY RUN - nothing will be saved' : 'Saving role changes in one transaction');
    const { changed, skipped } = await applyRoles(client);
    changed.forEach(c => console.log(`  changed  ${c.id}: ${c.from} -> ${c.to}`));
    skipped.forEach(s => console.log(`  skipped  ${s}`));
    if (dryRun) {
      await client.query('ROLLBACK');
      console.log(`Dry run finished: ${changed.length} change(s), nothing saved.`);
    } else {
      await client.query('COMMIT');
      console.log(`Done: ${changed.length} change(s) saved, each with an audit-log entry.`);
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => { });
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(e => { console.error('Role change failed, nothing was saved:', e.message); process.exit(1); });
}
module.exports = { applyRoles, CHANGES };
