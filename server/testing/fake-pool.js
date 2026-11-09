'use strict';
// A tiny in-memory stand-in for the pg Pool. It understands only the SQL statements the app uses,
// so the route tests can run without PostgreSQL. Unknown statements throw, so a new query is never
// silently ignored by a test.
const crypto = require('crypto');

function createFakePool(seed = {}) {
  const state = {
    accounts: (seed.accounts || []).map(a => ({ active: true, last_login: null, ...a })),
    sessions: [],
    kv: new Map(),                       // "coll|id" -> data
  };
  for (const [key, data] of Object.entries(seed.kv || {})) state.kv.set(key, JSON.parse(JSON.stringify(data)));

  const kvKey = (coll, id) => coll + '|' + id;
  const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

  function run(sql, params = []) {
    const q = sql.replace(/\s+/g, ' ').trim();
    let m;
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(q)) return { rows: [], rowCount: 0 };
    if (/^DELETE FROM sessions WHERE expires_at/.test(q)) return { rows: [], rowCount: 0 };

    // log-in and sessions
    if (q.includes('FROM sessions s JOIN accounts a')) {
      const s = state.sessions.find(x => x.token === params[0] && x.expires_at > Date.now());
      const a = s && state.accounts.find(x => x.id === s.account_id && x.active);
      return { rows: a ? [{ id: a.id, email: a.email, name: a.name }] : [], rowCount: a ? 1 : 0 };
    }
    if (q.startsWith('SELECT id, email, name, password_hash, active FROM accounts WHERE email')) {
      const a = state.accounts.find(x => x.email === params[0]);
      return { rows: a ? [{ id: a.id, email: a.email, name: a.name, password_hash: a.password_hash, active: a.active }] : [], rowCount: a ? 1 : 0 };
    }
    if (q.startsWith('INSERT INTO sessions')) {
      state.sessions.push({ token: params[0], account_id: params[1], expires_at: Date.now() + 12 * 3600 * 1000 });
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith('UPDATE accounts SET last_login')) return { rows: [], rowCount: 1 };
    if (q.startsWith('DELETE FROM sessions WHERE token')) {
      state.sessions = state.sessions.filter(s => s.token !== params[0]);
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith('DELETE FROM sessions WHERE account_id')) {
      state.sessions = state.sessions.filter(s => s.account_id !== params[0]);
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith('SELECT password_hash FROM accounts WHERE id')) {
      const a = state.accounts.find(x => x.id === params[0]);
      return { rows: a ? [{ password_hash: a.password_hash }] : [], rowCount: a ? 1 : 0 };
    }
    if (q.startsWith('UPDATE accounts SET password_hash')) {
      const a = state.accounts.find(x => x.id === params[1]);
      if (a) a.password_hash = params[0];
      return { rows: [], rowCount: a ? 1 : 0 };
    }
    if (q.startsWith('SELECT email FROM accounts WHERE id')) {
      const a = state.accounts.find(x => x.id === params[0]);
      return { rows: a ? [{ email: a.email }] : [], rowCount: a ? 1 : 0 };
    }
    if (q.startsWith('SELECT id, email, name FROM accounts WHERE id = ANY')) {
      const rows = state.accounts.filter(a => params[0].includes(a.id)).map(a => ({ id: a.id, email: a.email, name: a.name }));
      return { rows, rowCount: rows.length };
    }

    // documents
    if ((m = q.match(/^SELECT id, data FROM kv_docs WHERE coll = \$1/))) {
      const rows = [...state.kv.entries()].filter(([k]) => k.startsWith(params[0] + '|'))
        .map(([k, data]) => ({ id: k.split('|')[1], data: JSON.parse(JSON.stringify(data)) }));
      return { rows, rowCount: rows.length };
    }
    if (q.startsWith('INSERT INTO kv_docs (coll, id, data) VALUES ($1, $2, \'{}\'::jsonb)')) {
      if (!state.kv.has(kvKey(params[0], params[1]))) state.kv.set(kvKey(params[0], params[1]), {});
      return { rows: [], rowCount: 1 };
    }
    if ((m = q.match(/^INSERT INTO kv_docs \(coll, id, data, updated_by\) VALUES \(\$1, \$2, \$3::jsonb, \$4\)/)) ||
        q.startsWith("INSERT INTO kv_docs (coll, id, data, updated_by) VALUES ('m_audit', $1")) {
      const isLiteral = !m;
      const coll = isLiteral ? 'm_audit' : params[0];
      const id = isLiteral ? params[0] : params[1];
      const data = JSON.parse(isLiteral ? params[1] : params[2]);
      state.kv.set(kvKey(coll, id), data);
      return { rows: [], rowCount: 1 };
    }
    if ((m = q.match(/^UPDATE kv_docs SET data = \$1::jsonb, updated_by = '[^']*', updated_at = now\(\) WHERE coll = '([^']+)' AND id = '([^']+)'/))) {
      state.kv.set(kvKey(m[1], m[2]), JSON.parse(params[0]));
      return { rows: [], rowCount: 1 };
    }
    if ((m = q.match(/^SELECT data FROM kv_docs WHERE coll = '([^']+)' AND id = '([^']+)'( FOR UPDATE)?$/))) {
      return docRow(m[1], m[2]);
    }
    if ((m = q.match(/^SELECT data FROM kv_docs WHERE coll = '([^']+)' AND id = \$1( FOR UPDATE)?$/))) {
      return docRow(m[1], params[0]);
    }
    if ((m = q.match(/^SELECT data FROM kv_docs WHERE coll = \$1 AND id = \$2( FOR UPDATE)?$/))) {
      return docRow(params[0], params[1]);
    }
    if (q.startsWith('DELETE FROM kv_docs WHERE coll = $1 AND id = $2')) {
      const existed = state.kv.delete(kvKey(params[0], params[1]));
      return { rows: [], rowCount: existed ? 1 : 0 };
    }
    throw new Error('fake-pool: unhandled SQL: ' + q);
  }

  function docRow(coll, id) {
    const k = kvKey(coll, id);
    if (!state.kv.has(k)) return { rows: [], rowCount: 0 };
    return { rows: [{ data: JSON.parse(JSON.stringify(state.kv.get(k))) }], rowCount: 1 };
  }

  const pool = {
    state,
    query: async (sql, params) => run(sql, params),
    connect: async () => ({
      query: async (sql, params) => run(sql, params),
      release: () => { },
    }),
    end: async () => { },
  };
  return pool;
}

// Helper: a bcrypt hash for test accounts (low cost so the tests stay fast).
function hash(password) {
  return require('bcryptjs').hashSync(password, 4);
}

module.exports = { createFakePool, hash };
