'use strict';
// Storage behind the document routes (app.js). Chosen by DATA_MODE:
//   kv      (default) the kv_docs table, one row per document. This is the behaviour the app has always had.
//   tables  the relational tables from schema-tables.sql. The browser still gets the same chunked JSON:
//           a chunk is rebuilt from the rows that carry its chunk id, and a save writes the rows of that chunk.
//
// Both return the same shapes: list -> [{ id, data }], get -> data or null.
// Options: { client } runs the call inside a transaction, { forUpdate } locks the row.
const { REGISTERS, sid, nz, num, dateOf, realPo, lineAmount } = require('./registers');

const LOCK_RE = /^num-([A-Z_]+)-(\d{4})$/;   // the document-number locks: locks/num-TYPE-YEAR
const DATA_MODES = ['kv', 'tables'];

const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });

// The number log (m_numlog) lives in doc_numbers. Same columns as migrate-to-tables.js builds.
const NUMLOG = {
  coll: 'm_numlog', table: 'doc_numbers', key: 'no',
  cols: r => {
    const y = /\/(\d{4})\//.exec(nz(r.no) || '');
    return { type: nz(r.type), year: y ? +y[1] : null, seq: num(r.seq), issued_by: nz(r.by), issued_at: nz(r.t) };
  },
};
const SPECS = {};
REGISTERS.forEach(s => { SPECS[s.coll] = s; });
SPECS.m_numlog = NUMLOG;

function parseLock(id) {
  const m = LOCK_RE.exec(id);
  if (!m) throw httpError(400, 'invalid_argument', 'Only document-number locks are kept in tables mode');
  return { type: m[1], year: +m[2] };
}

/* ---------- kv_docs (the current behaviour) ---------- */
function kvStore(pool) {
  const run = (o, sql, params) => (o && o.client ? o.client : pool).query(sql, params);
  return {
    mode: 'kv',
    async list(coll) {
      const { rows } = await pool.query('SELECT id, data FROM kv_docs WHERE coll = $1 ORDER BY id', [coll]);
      return rows;
    },
    async get(coll, id, o = {}) {
      const { rows } = await run(o, 'SELECT data FROM kv_docs WHERE coll = $1 AND id = $2' + (o.forUpdate ? ' FOR UPDATE' : ''), [coll, id]);
      return rows.length ? rows[0].data : null;
    },
    async put(coll, id, data, by, o = {}) {
      await run(o, `INSERT INTO kv_docs (coll, id, data, updated_by) VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (coll, id) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [coll, id, JSON.stringify(data), by || null]);
    },
    async del(coll, id) {
      await pool.query('DELETE FROM kv_docs WHERE coll = $1 AND id = $2', [coll, id]);
    },
    async roleOf(accountId) {
      const users = (await this.get('m_users', 'all')) || {};
      const linked = Object.values(users.rows || {}).map(x => x && x.r).find(r => r && r.cid === accountId);
      return linked ? linked.role : null;
    },
    // Lease on a document (used for document numbers). Returns true when this holder now has it.
    async lease(coll, id, holder, ttlMs, now, o = {}) {
      const c = o.client || pool;
      await c.query(`INSERT INTO kv_docs (coll, id, data) VALUES ($1, $2, '{}'::jsonb) ON CONFLICT DO NOTHING`, [coll, id]);
      const { rows } = await c.query('SELECT data FROM kv_docs WHERE coll = $1 AND id = $2 FOR UPDATE', [coll, id]);
      const current = rows[0].data;
      const lease = current.__lease;
      if (lease && lease.until > now && lease.holder !== holder) return false;
      await this.put(coll, id, { ...current, __lease: { holder, until: now + ttlMs } }, o.by, o);
      return true;
    },
  };
}

/* ---------- relational tables ---------- */
function tablesStore(pool) {
  const spec = coll => SPECS[coll] || null;
  const q = (o, sql, params) => (o && o.client ? o.client : pool).query(sql, params);

  // Rebuild the rows map of one chunk from table rows: { rows: { key: { o, r } } }.
  const chunkDoc = rows => {
    const out = {};
    rows.forEach(x => { out[sid(x.k)] = { o: x.ord, r: x.record }; });
    return { rows: out };
  };

  return {
    mode: 'tables',
    async list(coll) {
      if (coll === 'cfg') {
        const { rows } = await pool.query('SELECT key AS id, data FROM settings ORDER BY key');
        return rows;
      }
      const s = spec(coll);
      if (!s) return [];   // locks are read one by one; other collections have no table
      const { rows } = await pool.query(`SELECT ${s.key} AS k, chunk, ord, record FROM ${s.table} ORDER BY chunk, ord`);
      const byChunk = new Map();
      rows.forEach(x => { if (!byChunk.has(x.chunk)) byChunk.set(x.chunk, []); byChunk.get(x.chunk).push(x); });
      return [...byChunk.keys()].sort().map(id => ({ id, data: chunkDoc(byChunk.get(id)) }));
    },
    async get(coll, id, o = {}) {
      if (coll === 'cfg') {
        const { rows } = await q(o, 'SELECT data FROM settings WHERE key = $1', [id]);
        return rows.length ? rows[0].data : null;
      }
      if (coll === 'locks') {
        const { type, year } = parseLock(id);
        const { rows } = await q(o, 'SELECT last_seq, holder, lease_until FROM number_counters WHERE type = $1 AND year = $2' + (o.forUpdate ? ' FOR UPDATE' : ''), [type, year]);
        if (!rows.length) return null;
        const doc = { last: rows[0].last_seq };
        if (rows[0].holder) doc.__lease = { holder: rows[0].holder, until: Number(rows[0].lease_until) };
        return doc;
      }
      const s = spec(coll);
      if (!s) return null;
      const { rows } = await q(o, `SELECT ${s.key} AS k, ord, record FROM ${s.table} WHERE chunk = $1 ORDER BY ord`, [id]);
      return rows.length ? chunkDoc(rows) : null;
    },
    // Saves one document. For a register chunk: upsert each record and its lines, then remove the
    // rows of this chunk that are no longer in it.
    async put(coll, id, data, by, o = {}) {
      if (coll === 'cfg') {
        await q(o, `INSERT INTO settings (key, data) VALUES ($1, $2::jsonb)
          ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [id, JSON.stringify(data)]);
        return;
      }
      if (coll === 'locks') {
        const { type, year } = parseLock(id);
        const lease = data.__lease || {};
        await q(o, `INSERT INTO number_counters (type, year, last_seq, holder, lease_until) VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (type, year) DO UPDATE SET last_seq = EXCLUDED.last_seq, holder = EXCLUDED.holder, lease_until = EXCLUDED.lease_until`,
        [type, year, num(data.last) || 0, lease.holder || null, lease.until || null]);
        return;
      }
      const s = spec(coll);
      if (!s) throw httpError(400, 'invalid_argument', 'This collection is not kept in tables mode');
      const keep = [];
      for (const [chunkKey, entry] of Object.entries((data && data.rows) || {})) {
        const r = entry && entry.r;
        if (!r || typeof r !== 'object') throw httpError(400, 'invalid_argument', `Bad record ${chunkKey}`);
        const key = nz(r[s.key]);
        if (!key) throw httpError(400, 'invalid_argument', `A record in ${coll} has no ${s.key}`);
        const cols = s.cols(r, []);
        const names = [s.key, ...Object.keys(cols), 'chunk', 'ord', 'record'];
        const values = [key, ...Object.values(cols), id, num(entry.o) ?? 0, JSON.stringify(r)];
        const params = names.map((n, i) => (n === 'record' ? `$${i + 1}::jsonb` : `$${i + 1}`));
        const update = names.filter(n => n !== s.key).map(n => `${n} = EXCLUDED.${n}`).join(', ');
        await q(o, `INSERT INTO ${s.table} (${names.join(', ')}) VALUES (${params.join(', ')})
          ON CONFLICT (${s.key}) DO UPDATE SET ${update}`, values);
        if (s.lines) {
          await q(o, `DELETE FROM ${s.lines.table} WHERE ${s.lines.parent} = $1`, [key]);
          const lines = s.lines.from(r);
          for (let i = 0; i < lines.length; i++) {
            const lc = s.lines.cols(lines[i]);
            const ln = [s.lines.parent, 'line_no', ...Object.keys(lc), 'record'];
            const lv = [key, i + 1, ...Object.values(lc), JSON.stringify(lines[i])];
            const lp = ln.map((n, j) => (n === 'record' ? `$${j + 1}::jsonb` : `$${j + 1}`));
            await q(o, `INSERT INTO ${s.lines.table} (${ln.join(', ')}) VALUES (${lp.join(', ')})`, lv);
          }
        }
        keep.push(key);
      }
      await q(o, `DELETE FROM ${s.table} WHERE chunk = $1 AND NOT (${s.key} = ANY($2::text[]))`, [id, keep]);
    },
    async del(coll, id) {
      if (coll === 'cfg') return void await pool.query('DELETE FROM settings WHERE key = $1', [id]);
      if (coll === 'locks') return;   // counters are not deleted
      const s = spec(coll);
      if (s) await pool.query(`DELETE FROM ${s.table} WHERE chunk = $1`, [id]);
    },
    async roleOf(accountId) {
      const { rows } = await pool.query('SELECT role FROM users WHERE cid = $1 LIMIT 1', [accountId]);
      return rows.length ? rows[0].role : null;
    },
    async lease(coll, id, holder, ttlMs, now, o = {}) {
      if (coll !== 'locks') throw httpError(400, 'invalid_argument', 'Only document-number locks are kept in tables mode');
      const { type, year } = parseLock(id);
      const c = o.client || pool;
      await c.query('INSERT INTO number_counters (type, year, last_seq) VALUES ($1, $2, 0) ON CONFLICT DO NOTHING', [type, year]);
      const { rows } = await c.query('SELECT holder, lease_until FROM number_counters WHERE type = $1 AND year = $2 FOR UPDATE', [type, year]);
      const cur = rows[0];
      if (cur.lease_until && Number(cur.lease_until) > now && cur.holder !== holder) return false;
      await c.query('UPDATE number_counters SET holder = $3, lease_until = $4 WHERE type = $1 AND year = $2', [type, year, holder, now + ttlMs]);
      return true;
    },
  };
}

function createStore(pool, mode) {
  const m = mode || 'kv';
  if (!DATA_MODES.includes(m)) throw new Error(`DATA_MODE must be one of ${DATA_MODES.join(', ')} (got ${m})`);
  return m === 'tables' ? tablesStore(pool) : kvStore(pool);
}

module.exports = { createStore, DATA_MODES, parseLock };
