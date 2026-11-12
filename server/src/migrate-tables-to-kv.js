'use strict';
// Copies the relational tables back into kv_docs. This is the rollback path for DATA_MODE=tables:
// after the app is switched back to DATA_MODE=kv, kv_docs must hold every save made in tables mode.
//
// Run from the server folder, against the database named in DATABASE_URL (or the DB_* settings):
//   node src/migrate-tables-to-kv.js                                  dry run: build, check, roll back
//   node src/migrate-tables-to-kv.js --apply --confirm-target HOST/DB  build, check, commit
//   add --report <file.json> to keep the full report
//
// Rules:
// - The tables are read under SHARE locks, so a save cannot land in them during the run and be missed.
//   The locks are released at COMMIT or ROLLBACK. Saves attempted meanwhile wait (lock_timeout 15 s).
// - Each document is rebuilt from the `record` / `data` JSON the app saved. Nothing is recomputed.
// - --apply first copies the current kv_docs to a backup table (kv_docs_backup_<time>), then replaces
//   kv_docs. The backup name is written to migration_runs, so the old copy can be restored.
// - Before commit, the rebuilt documents are read back and run through the forward mapping
//   (buildPlan in migrate-to-tables.js). The records must match the tables exactly, or the run stops.
// - Any problem rolls everything back. Nothing is guessed or skipped silently.
// - --apply needs --confirm-target, which must equal the target shown in the output (HOST/DB).
const fs = require('fs');
const { Client } = require('pg');
const { connectionConfig } = require('./db');
const { sid, canonStr, REGISTERS, TABLES } = require('./registers');
const { buildPlan, targetName } = require('./migrate-to-tables');

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const APPLY = args.includes('--apply');
const REPORT_FILE = opt('--report');
const CONFIRM = opt('--confirm-target');
const BATCH = 20;   // documents per INSERT: chunks can be large

// ---------- rebuild the kv documents from the tables ----------
async function rebuildDocs(client, report) {
  const docs = [];
  const counts = {};

  // settings -> cfg documents (the same ids and shapes the app saved)
  const st = await client.query('SELECT key, data FROM settings ORDER BY key');
  st.rows.forEach(r => docs.push({ coll: 'cfg', id: r.key, data: r.data }));
  counts.cfg = st.rows.length;

  // number counters -> locks documents. Leases are kept only while they are set; expired ones are ignored by the app.
  const nc = await client.query('SELECT type, year, last_seq, holder, lease_until FROM number_counters ORDER BY type, year');
  nc.rows.forEach(r => {
    const data = { last: Number(r.last_seq) };
    if (r.holder) data.__lease = { holder: r.holder, until: Number(r.lease_until) };
    docs.push({ coll: 'locks', id: `num-${r.type}-${r.year}`, data });
  });
  counts.locks = nc.rows.length;

  // register tables -> one chunked document per chunk id. Rows are keyed by sid(key), as the app writes them.
  // Line tables are not written back: the app keeps the lines inside each record.
  for (const s of REGISTERS) {
    const { rows } = await client.query(`SELECT ${s.key} AS k, chunk, ord, record FROM ${s.table} ORDER BY chunk, ord, ${s.key}`);
    const byChunk = new Map();
    rows.forEach(x => {
      if (!x.chunk) throw new Error(`${s.table} row ${x.k} has no chunk id`);
      if (!byChunk.has(x.chunk)) byChunk.set(x.chunk, {});
      byChunk.get(x.chunk)[sid(x.k)] = { o: x.ord, r: x.record };
    });
    byChunk.forEach((rowsMap, id) => docs.push({ coll: s.coll, id, data: { rows: rowsMap } }));
    counts[s.coll] = (counts[s.coll] || 0) + rows.length;
  }

  // doc_numbers -> m_numlog (the number log)
  const dn = await client.query('SELECT no, chunk, ord, record FROM doc_numbers ORDER BY chunk, ord, no');
  const numChunks = new Map();
  dn.rows.forEach(x => {
    if (!x.chunk) throw new Error(`doc_numbers row ${x.no} has no chunk id`);
    if (!numChunks.has(x.chunk)) numChunks.set(x.chunk, {});
    numChunks.get(x.chunk)[sid(x.no)] = { o: x.ord, r: x.record };
  });
  numChunks.forEach((rowsMap, id) => docs.push({ coll: 'm_numlog', id, data: { rows: rowsMap } }));
  counts.m_numlog = dn.rows.length;

  report.counts = counts;
  report.documents = docs.length;
  return docs;
}

// ---------- compare with the current kv_docs ----------
function diffAgainst(current, rebuilt) {
  const cur = new Map(current.map(d => [d.coll + '|' + d.id, canonStr(d.data)]));
  const next = new Map(rebuilt.map(d => [d.coll + '|' + d.id, canonStr(d.data)]));
  const out = { changed: [], added: [], removed: [] };
  next.forEach((v, k) => {
    if (!cur.has(k)) out.added.push(k);
    else if (cur.get(k) !== v) out.changed.push(k);
  });
  cur.forEach((v, k) => { if (!next.has(k)) out.removed.push(k); });
  return out;
}

// ---------- check: the rebuilt documents, read back from kv_docs, map back onto the tables ----------
async function verify(client, rebuilt, report) {
  const check = (name, expected, actual) => {
    const ok = expected === actual;
    report.checks.push({ name, expected, actual, ok });
    if (!ok) throw new Error(`check failed: ${name}: expected ${expected}, found ${actual}`);
  };

  // every rebuilt document is in kv_docs, unchanged
  const { rows: back } = await client.query('SELECT coll, id, data FROM kv_docs');
  check('documents in kv_docs', rebuilt.length, back.length);
  const byKey = new Map(back.map(d => [d.coll + '|' + d.id, canonStr(d.data)]));
  let bad = 0;
  rebuilt.forEach(d => { if (byKey.get(d.coll + '|' + d.id) !== canonStr(d.data)) bad++; });
  check('documents that differ from the tables', 0, bad);

  // forward mapping of the kv_docs gives back the table rows: same records, same counts
  const plan = buildPlan(back, [], { skipped: {} });
  const cols = { settings: 'data', number_counters: null, doc_numbers: 'record' };
  for (const t of TABLES) {
    const planRows = plan.rows[t] || [];
    const { rows } = await client.query(t === 'number_counters'
      ? 'SELECT last_seq FROM number_counters'
      : `SELECT ${cols[t] || 'record'} AS v FROM ${t}`);
    const fromPlan = planRows.map(r => {
      const v = r.values;
      if (t === 'number_counters') return canonStr({ last: Number(v.last_seq) });
      return canonStr(v.record !== undefined ? v.record : v.data);
    }).sort();
    const fromDb = rows.map(r => canonStr(t === 'number_counters' ? { last: Number(r.last_seq) } : r.v)).sort();
    const same = fromPlan.length === fromDb.length && fromPlan.every((x, i) => x === fromDb[i]);
    report.checks.push({ name: `round trip: ${t}`, expected: fromPlan.length, actual: fromDb.length, ok: same });
    if (!same) throw new Error(`check failed: round trip of ${t}: ${fromPlan.length} rows from kv_docs, ${fromDb.length} in the table, or the records differ`);
  }
}

// ---------- write ----------
async function writeKv(client, rebuilt, stamp, report) {
  const backup = `kv_docs_backup_${stamp}`;
  await client.query(`CREATE TABLE ${backup} AS SELECT * FROM kv_docs`);
  const n = (await client.query(`SELECT count(*)::int AS n FROM ${backup}`)).rows[0].n;
  report.backup = { table: backup, rows: n };
  console.log(`backed up kv_docs to ${backup} (${n} documents)`);
  await client.query('DELETE FROM kv_docs');
  for (let i = 0; i < rebuilt.length; i += BATCH) {
    const part = rebuilt.slice(i, i + BATCH);
    const params = [];
    const tuples = part.map(d => {
      params.push(d.coll, d.id, JSON.stringify(d.data), 'tables-to-kv');
      const p = params.length;
      return `($${p - 3}, $${p - 2}, $${p - 1}::jsonb, $${p})`;
    });
    await client.query(`INSERT INTO kv_docs (coll, id, data, updated_by) VALUES ${tuples.join(', ')}`, params);
  }
  console.log(`wrote ${rebuilt.length} documents to kv_docs`);
}

// ---------- run ----------
async function main() {
  const cfg = connectionConfig();
  const target = targetName(cfg);
  const report = { mode: APPLY ? 'apply' : 'dry-run', direction: 'tables-to-kv', target, started: new Date().toISOString(), counts: {}, checks: [], diff: {}, skipped: {} };
  if (APPLY && CONFIRM !== target) {
    console.error(`--apply needs --confirm-target ${target} (the target shown above). Nothing was changed.`);
    process.exitCode = 2;
    return;
  }
  console.log(`Target: ${target}  mode: ${report.mode}  direction: tables -> kv_docs`);
  let step = 'connecting';
  let finished = false;
  process.once('beforeExit', () => { if (!finished) console.log('STOPPED before the run finished, at step: ' + step); });
  const client = new Client({ ...cfg, query_timeout: 120000 });
  await client.connect();
  console.log('connected');
  let ok = false;
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  try {
    step = 'locking the tables';
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await client.query("SET LOCAL lock_timeout = '15s'");
    await client.query(`LOCK TABLE ${TABLES.join(', ')} IN SHARE MODE`);
    console.log('tables locked against writes until this run ends');

    step = 'rebuilding documents';
    const rebuilt = await rebuildDocs(client, report);
    console.log(`rebuilt ${rebuilt.length} documents`);

    step = 'comparing with kv_docs';
    const { rows: current } = await client.query('SELECT coll, id, data FROM kv_docs');
    report.diff = diffAgainst(current, rebuilt);
    report.diff.counts = { changed: report.diff.changed.length, added: report.diff.added.length, removed: report.diff.removed.length, currentDocuments: current.length };
    console.log('differences from current kv_docs:', JSON.stringify(report.diff.counts));

    // written in both modes: a dry run checks the real write, then rolls it back
    step = 'writing kv_docs';
    await writeKv(client, rebuilt, stamp, report);

    step = 'checking';
    await verify(client, rebuilt, report);
    console.log('checks passed');

    step = 'finishing';
    report.finished = new Date().toISOString();
    if (APPLY) {
      report.status = 'applied and committed';
      await client.query('INSERT INTO migration_runs (mode, target, status, report) VALUES ($1, $2, $3, $4::jsonb)',
        ['tables-to-kv', target, 'applied', JSON.stringify(report)]);
      await client.query('COMMIT');
    } else {
      await client.query('ROLLBACK');
      report.status = 'dry run passed; nothing was written';
    }
    ok = true;
  } catch (e) {
    console.log('error at step: ' + step);
    await client.query('ROLLBACK').catch(() => { });
    report.status = 'FAILED, rolled back: ' + e.message;
    report.stack = e.stack;
  } finally {
    await client.end().catch(() => { });
    finished = true;
  }
  report.finished = report.finished || new Date().toISOString();
  const shown = { ...report.diff, changed: report.diff.changed.slice(0, 20), added: report.diff.added.slice(0, 20), removed: report.diff.removed.slice(0, 20) };
  console.log(JSON.stringify({ status: report.status, counts: report.counts, backup: report.backup, diff: shown, failedChecks: report.checks.filter(c => !c.ok) }, null, 2));
  if (REPORT_FILE) fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  process.exitCode = ok ? 0 : 1;   // not process.exit(): it can cut off output when stdout is a pipe
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exitCode = 1; });
}

module.exports = { rebuildDocs, diffAgainst };
