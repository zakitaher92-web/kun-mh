'use strict';
// Parity check for DATA_MODE=tables. Run it on a database after migrate-to-tables --apply:
//   DATABASE_URL=... node testing/parity-tables.js
// 1. Reads every collection through the kv store and the tables store and compares them.
//    They must be identical: the browser would see the same documents in either mode.
// 2. Writes a changed item chunk through the tables store inside a transaction, reads it back,
//    and rolls back. Nothing is kept.
const { Pool } = require('pg');
const { connectionConfig } = require('../src/db');
const { createStore } = require('../src/store');
const { canonStr, sid } = require('../src/registers');

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

async function main() {
  const pool = new Pool({ ...connectionConfig(), max: 4, query_timeout: 30000 });   // a stuck query fails with an error
  const kv = createStore(pool, 'kv');
  const tb = createStore(pool, 'tables');
  let failures = 0;

  // 1. collections
  const colls = (await pool.query('SELECT DISTINCT coll FROM kv_docs ORDER BY coll')).rows.map(r => r.coll);
  for (const coll of colls) {
    if (coll === 'locks') continue;   // compared document by document below
    const a = (await kv.list(coll)).map(d => ({ id: d.id, data: d.data })).sort(byId);
    const b = (await tb.list(coll)).sort(byId);
    const same = canonStr(a) === canonStr(b);
    if (!same) {
      failures++;
      const ids = new Set([...a.map(x => x.id), ...b.map(x => x.id)]);
      const diff = [...ids].filter(id => {
        const x = a.find(d => d.id === id), y = b.find(d => d.id === id);
        return canonStr(x && x.data) !== canonStr(y && y.data);
      });
      console.log(`MISMATCH ${coll}: kv ${a.length} docs, tables ${b.length} docs; differing ids: ${diff.slice(0, 5).join(', ')}`);
    } else {
      console.log(`ok       ${coll}: ${a.length} docs`);
    }
  }

  // 1b. document-number locks
  const locks = (await pool.query("SELECT id, data FROM kv_docs WHERE coll = 'locks' ORDER BY id")).rows;
  for (const l of locks) {
    // the copy keeps the counter, not the lease (leases are short-lived), so compare the counter
    const t = await tb.get('locks', l.id);
    const same = (t && t.last) === (l.data && l.data.last);
    if (!same) failures++;
    console.log(`${same ? 'ok      ' : 'MISMATCH'} locks ${l.id}: ${JSON.stringify(l.data)} vs ${JSON.stringify(t)}`);
  }

  // 2. write path, rolled back
  console.log('write path: starting');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '10s'");   // a row locked by another session fails here, not hanging
    const before = await tb.get('m_items', 'all', { client, forUpdate: true });
    if (!before) throw new Error('no item chunk in the tables to test with');
    const rows = { ...before.rows };
    const keys = Object.keys(rows);
    const removed = keys[0];
    delete rows[removed];
    const sample = rows[keys[1]];
    const changed = { ...sample.r, name: 'PARITY TEST NAME' };
    rows[keys[1]] = { o: sample.o, r: changed };
    const added = { code: 'PARITY-NEW-1', name: 'Parity test item', cat: sample.r.cat, unit: 'nos', ex: false };
    rows[sid(added.code)] = { o: 9999, r: added };
    const wanted = { rows };
    await tb.put('m_items', 'all', wanted, 'parity-test', { client });
    const back = await tb.get('m_items', 'all', { client });
    const ok = canonStr(back) === canonStr(wanted);
    if (!ok) failures++;
    console.log(`${ok ? 'ok      ' : 'MISMATCH'} write path: removed ${removed}, changed ${keys[1]}, added ${added.code}, read back equal: ${ok}`);
    await client.query('ROLLBACK');
    console.log('rolled back the write test');
  } catch (e) {
    failures++;
    console.log('MISMATCH write path: ' + e.message);
    client.release(true);   // destroy the connection: the server rolls the transaction back
    return finish(failures, pool);
  }
  client.release();

  return finish(failures, pool);
}

async function finish(failures, pool) {
  await pool.end().catch(() => { });
  console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
  process.exitCode = failures ? 1 : 0;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
