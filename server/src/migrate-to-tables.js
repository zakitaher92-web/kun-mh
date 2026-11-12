'use strict';
// Copies the kv_docs documents into the relational tables (server/schema-tables.sql).
//
// Run from the server folder, against the database named in DATABASE_URL (or the DB_* settings):
//   node src/migrate-to-tables.js                                  dry run: copy, check, roll back
//   node src/migrate-to-tables.js --apply --confirm-target HOST/DB  copy, check, commit
//   add --report <file.json> to keep the full report
//
// Rules:
// - kv_docs is only read. It is never changed.
// - All reads come from one REPEATABLE READ snapshot, so every collection is from the same moment.
// - Each run empties the new tables and loads them again, so a rerun gives the same result.
// - Any problem stops the run and rolls everything back: a record without a key, a duplicate key,
//   a count or value that does not match the source. Nothing is guessed or skipped silently.
// - --apply needs --confirm-target, which must equal the target shown in the output (HOST/DB).
//   This stops a run against the wrong database by accident.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { connectionConfig } = require('./db');

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const APPLY = args.includes('--apply');
const REPORT_FILE = opt('--report');
const CONFIRM = opt('--confirm-target');
const SCHEMA_FILE = path.join(__dirname, '..', 'schema-tables.sql');

const { sid, nz, num, dateOf, realPo, lineAmount, canon, canonStr, sumOf, REGISTERS, TABLES } = require('./registers');

// ---------- build the rows from the snapshot ----------
function buildPlan(docs, warnings, report) {
  const plan = { rows: {}, expect: {}, sources: {} }; // rows[table] = [{values}], expect = counts from the source
  TABLES.forEach(t => { plan.rows[t] = []; });
  const seenKeys = {};   // "table|key" -> true, to catch duplicates

  // config documents: all of them go to settings; budget lines and categories are also split out
  const cfg = docs.filter(d => d.coll === 'cfg');
  cfg.forEach(d => plan.rows.settings.push({ values: { key: d.id, data: d.data } }));
  const cfgValue = id => { const d = cfg.find(x => x.id === id); return d && d.data && Array.isArray(d.data.v) ? d.data.v : null; };
  (cfgValue('budgetLines') || []).forEach((b, i) => {
    if (!nz(b.code)) throw new Error(`budget line without a code at position ${i}`);
    plan.rows.budget_lines.push({ values: { code: nz(b.code), name: nz(b.name) || '', basis: nz(b.basis), annual: num(b.annual), ord: i, record: b } });
  });
  (cfgValue('categories') || []).forEach((c, i) => {
    if (!nz(c.name)) throw new Error(`category without a name at position ${i}`);
    plan.rows.categories.push({ values: { name: nz(c.name), budget_line: nz(c.line), type: nz(c.type), ord: i, record: c } });
  });

  // locks: only the document-number counters are kept; other leases are short-lived and not stored
  let skippedLeases = 0;
  docs.filter(d => d.coll === 'locks').forEach(d => {
    const m = /^num-([A-Z_]+)-(\d{4})$/.exec(d.id);
    if (!m) { skippedLeases++; return; }
    plan.rows.number_counters.push({ values: { type: m[1], year: +m[2], last_seq: num(d.data && d.data.last) || 0 } });
  });
  report.skipped = { leases: skippedLeases };

  // registers: each chunk holds rows keyed by a sanitised key; the record holds the real key
  let keyMismatch = 0, legacyPo = 0;
  REGISTERS.forEach(spec => {
    const chunks = docs.filter(d => d.coll === spec.coll);
    chunks.forEach(d => {
      const rows = (d.data && d.data.rows) || {};
      Object.entries(rows).forEach(([chunkKey, entry]) => {
        const r = entry && entry.r;
        if (!r || typeof r !== 'object') throw new Error(`${spec.coll} ${d.id}: entry ${chunkKey} has no record`);
        const key = nz(r[spec.key]);
        if (!key) throw new Error(`${spec.coll} ${d.id}: record ${chunkKey} has no ${spec.key}`);
        const tk = spec.table + '|' + key;
        if (seenKeys[tk]) throw new Error(`${spec.table}: duplicate key ${key}`);
        seenKeys[tk] = true;
        if (sid(key) !== chunkKey) keyMismatch++;
        if (spec.coll === 'm_grns' || spec.coll === 'm_srns' || spec.coll === 'm_bills') {
          if (r.po === 'NO PO') legacyPo++;
        }
        const ord = num(entry.o) ?? 0;
        plan.rows[spec.table].push({ values: { [spec.key]: key, ...spec.cols(r, warnings), chunk: d.id, ord, record: r } });
        if (spec.lines) {
          const lines = spec.lines.from(r);
          if (!Array.isArray(lines)) throw new Error(`${spec.table} ${key}: lines is not a list`);
          lines.forEach((l, i) => {
            plan.rows[spec.lines.table].push({ values: { [spec.lines.parent]: key, line_no: i + 1, ...spec.lines.cols(l), record: l } });
          });
        }
      });
    });
  });
  report.skipped.keyMismatch = keyMismatch;
  report.skipped.legacyNoPoText = legacyPo;

  // number log -> doc_numbers
  plan.expect.doc_numbers = 0;
  const seqSeen = {};
  docs.filter(d => d.coll === 'm_numlog').forEach(d => {
    Object.entries((d.data && d.data.rows) || {}).forEach(([chunkKey, entry]) => {
      const r = entry.r;
      const no = nz(r.no);
      const y = /\/(\d{4})\//.exec(no || '');
      if (!no || !y) throw new Error(`number log entry ${chunkKey} has no year in its number`);
      const seq = num(r.seq);
      if (seq === null) throw new Error(`number log ${no} has no sequence`);
      const sk = `${r.type}|${y[1]}|${seq}`;
      if (seqSeen[sk]) throw new Error(`number ${r.type} ${y[1]}/${seq} issued twice`);
      seqSeen[sk] = true;
      plan.rows.doc_numbers.push({ values: { no, type: nz(r.type), year: +y[1], seq, issued_by: nz(r.by), issued_at: nz(r.t), chunk: d.id, ord: num(entry.o) ?? 0, record: r } });
      plan.expect.doc_numbers++;
    });
  });

  TABLES.forEach(t => { plan.expect[t] = plan.rows[t].length; });
  plan.expect.settings = cfg.length;
  return plan;
}

// ---------- write ----------
async function loadAll(client, plan) {
  await client.query(`TRUNCATE ${TABLES.join(', ')} CASCADE`);
  for (const t of TABLES) {
    console.log('loading ' + t + ' (' + plan.rows[t].length + ' rows)');
    for (const row of plan.rows[t]) {
      const cols = Object.keys(row.values);
      const isJson = c => c === 'record' || c === 'data';
      const params = cols.map((c, i) => isJson(c) ? `$${i + 1}::jsonb` : `$${i + 1}`);
      const values = cols.map(c => isJson(c) ? JSON.stringify(row.values[c]) : row.values[c]);
      await client.query(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${params.join(', ')})`, values);
    }
  }
}

// ---------- check against the source, inside the same transaction ----------
async function verify(client, plan, docs, report) {
  const check = (name, expected, actual) => {
    const ok = expected === actual;
    report.checks.push({ name, expected, actual, ok });
    if (!ok) throw new Error(`check failed: ${name}: expected ${expected}, found ${actual}`);
  };

  // row counts per table
  for (const t of TABLES) {
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${t}`);
    check(`rows in ${t}`, plan.expect[t], rows[0].n);
  }

  // records equal the source records
  const sameRecords = async (table, keyCols, expectedList, recCol = 'record') => {
    const { rows } = await client.query(`SELECT ${keyCols.join(', ')}, ${recCol} AS rec FROM ${table}`);
    const got = new Map(rows.map(r => [keyCols.map(c => String(r[c])).join('|'), canonStr(r.rec)]));
    let bad = 0;
    expectedList.forEach(e => {
      const k = keyCols.map(c => String(e.values[c])).join('|');
      if (got.get(k) !== canonStr(e.values[recCol])) bad++;
    });
    check(`records equal the source in ${table}`, 0, bad);
  };
  for (const spec of REGISTERS) {
    await sameRecords(spec.table, [spec.key], plan.rows[spec.table]);
    if (spec.lines) await sameRecords(spec.lines.table, [spec.lines.parent, 'line_no'], plan.rows[spec.lines.table]);
  }
  await sameRecords('doc_numbers', ['no'], plan.rows.doc_numbers);
  await sameRecords('settings', ['key'], plan.rows.settings, 'data');

  // totals: the money and quantity fields add up to the source
  const bills = docs.filter(d => d.coll === 'm_bills').flatMap(d => Object.values((d.data && d.data.rows) || {}));
  const grnLines = docs.filter(d => d.coll === 'm_grns').flatMap(d => Object.values((d.data && d.data.rows) || {})).flatMap(e => e.r.lines || []);
  const billItems = plan.rows.bill_items.map(x => x.values);
  const dbTotal = async (sql) => Number((await client.query(sql)).rows[0].total || 0);
  check('sum of bill amounts', Math.round(sumOf(bills, e => num(e.r.amount))), Math.round(await dbTotal('SELECT sum(amount) AS total FROM bills')));
  check('sum of GRN accepted quantities', Math.round(sumOf(grnLines, l => num(l.acc))), Math.round(await dbTotal('SELECT sum(accepted) AS total FROM grn_lines')));
  check('sum of bill item amounts', Math.round(sumOf(billItems, x => x.amount)), Math.round(await dbTotal('SELECT sum(amount) AS total FROM bill_items')));
}

// ---------- run ----------
function targetName(cfg) {
  if (cfg.connectionString) {
    const u = new URL(cfg.connectionString);
    return `${u.hostname}/${u.pathname.replace(/^\//, '')}`;
  }
  return `${cfg.host}/${cfg.database}`;
}

async function main() {
  const cfg = connectionConfig();
  const target = targetName(cfg);
  const report = { mode: APPLY ? 'apply' : 'dry-run', target, started: new Date().toISOString(), counts: {}, checks: [], warnings: [], skipped: {} };
  if (APPLY && CONFIRM !== target) {
    console.error(`--apply needs --confirm-target ${target} (the target shown above). Nothing was changed.`);
    process.exitCode = 2;
    return;
  }
  console.log(`Target: ${target}  mode: ${report.mode}`);
  let step = 'connecting';
  let finished = false;
  // If the event loop empties before the run finishes (a dropped connection, for example), say where it stopped.
  process.once('beforeExit', () => { if (!finished) console.log('STOPPED before the run finished, at step: ' + step); });
  const client = new Client({ ...cfg, query_timeout: 60000 });   // a stuck statement fails after 60 s instead of hanging
  await client.connect();
  console.log('connected');
  let ok = false;
  try {
    step = 'reading kv_docs';
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    // a table locked by another session (for example an idle transaction left by an earlier run) fails here after 15 s
    await client.query("SET LOCAL lock_timeout = '15s'");
    const { rows: docs } = await client.query('SELECT coll, id, data FROM kv_docs');
    console.log('read ' + docs.length + ' documents');
    step = 'building rows';
    const plan = buildPlan(docs, report.warnings, report);
    console.log('built rows');
    step = 'creating tables';
    report.counts = plan.expect;
    await client.query(fs.readFileSync(SCHEMA_FILE, 'utf8'));
    await loadAll(client, plan);
    console.log('loaded rows');
    step = 'checking against the source';
    await verify(client, plan, docs, report);
    console.log('checks passed');
    step = 'finishing';
    report.finished = new Date().toISOString();
    if (APPLY) {
      await client.query('INSERT INTO migration_runs (mode, target, status, report) VALUES ($1, $2, $3, $4::jsonb)',
        ['apply', target, 'applied', JSON.stringify(report)]);
      await client.query('COMMIT');
      report.status = 'applied and committed';
    } else {
      await client.query('ROLLBACK');
      report.status = 'dry run passed; nothing was written';
    }
    ok = true;
  } catch (e) {
    console.log('error at step: ' + step);
    await client.query('ROLLBACK').catch(() => { });
    report.status = 'FAILED, rolled back: ' + e.message; report.stack = e.stack;
  } finally {
    await client.end().catch(() => { });
    finished = true;
  }
  report.finished = report.finished || new Date().toISOString();
  console.log(JSON.stringify({ status: report.status, counts: report.counts, failedChecks: report.checks.filter(c => !c.ok), warnings: report.warnings.length, skipped: report.skipped }, null, 2));
  if (REPORT_FILE) fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  process.exitCode = ok ? 0 : 1;   // not process.exit(): it can cut off output when stdout is a pipe
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exitCode = 1; });
}

module.exports = { buildPlan, REGISTERS, TABLES, sid, canonStr, targetName };
