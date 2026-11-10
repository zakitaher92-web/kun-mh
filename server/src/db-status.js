'use strict';
// Shows the tables and record counts of the database named in the environment (no secrets printed).
// Usage: npm run db:status   (set DATABASE_URL, or the DB_* settings, first)
const { createPool, applySchema } = require('./db');

async function main() {
  const pool = createPool();
  try {
    const mode = process.argv.includes('--apply') ? 'apply the schema first' : 'read only';
    if (process.argv.includes('--apply')) {
      await applySchema(pool);
      console.log('Schema applied (safe to run again).');
    }
    const who = await pool.query('SELECT current_database() AS db, current_user AS usr, version() AS ver');
    console.log(`Database: ${who.rows[0].db} as ${who.rows[0].usr}`);
    console.log(`PostgreSQL: ${who.rows[0].ver.split(' ').slice(0, 2).join(' ')}`);
    const tables = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`);
    console.log(`Tables (${mode}): ${tables.rows.map(r => r.table_name).join(', ') || '(none)'}`);
    const counts = await pool.query(`SELECT coll, count(*)::int AS n FROM kv_docs GROUP BY coll ORDER BY coll`).catch(() => ({ rows: [] }));
    console.log('Records by collection:');
    if (!counts.rows.length) console.log('  (none yet)');
    counts.rows.forEach(r => console.log(`  ${r.coll.padEnd(14)} ${r.n}`));
    const accts = await pool.query('SELECT count(*)::int AS n FROM accounts').catch(() => ({ rows: [{ n: 'n/a' }] }));
    console.log(`Log-in accounts: ${accts.rows[0].n}`);
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error('Database check failed:', e.message); process.exit(1); });
