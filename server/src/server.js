'use strict';
// KUN Maintenance & Housekeeping - local server.
// Serves index.html and a small API that stores the app's documents in PostgreSQL.
// The app talks to this API through client/server-adapter.js (injected into index.html below).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const { createPool, applySchema } = require('./db');

const APP_DIR = path.join(__dirname, '..', '..');          // the kun-mh folder (index.html)
const CLIENT_DIR = path.join(__dirname, '..', 'client');   // server-adapter.js
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';              // only this computer by default
const COOKIE = 'kunmh_sid';
const SESSION_HOURS = 12;
const COLL_RE = /^[a-z_]{1,60}$/;
const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,190}$/;             // same characters the app allows in document ids
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);   // keeps log-in timing the same for unknown emails
const DEADLOCK = '40P01';                                  // PostgreSQL error code for a deadlock

const pool = createPool();
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));                   // one chunk of register rows can be large

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });

function readCookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
function checkColl(c) { if (!COLL_RE.test(c)) throw httpError(400, 'invalid_argument', 'Bad collection name'); }
function checkId(i) { if (!ID_RE.test(i)) throw httpError(400, 'invalid_argument', 'Bad document id'); }
function isPlain(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

// Merge: nested objects are merged key by key; arrays and other values are replaced.
function deepMerge(base, patch) {
  if (!isPlain(base) || !isPlain(patch)) return patch;
  const out = { ...base };
  for (const k of Object.keys(patch)) out[k] = k in out ? deepMerge(out[k], patch[k]) : patch[k];
  return out;
}

// Runs fn inside a transaction; retries if PostgreSQL reports a deadlock.
async function txn(fn) {
  for (let attempt = 1; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => { });
      if (e.code === DEADLOCK && attempt < 4) continue;
      throw e;
    } finally {
      client.release();
    }
  }
}
async function upsert(client, coll, id, data, by) {
  await client.query(
    `INSERT INTO kv_docs (coll, id, data, updated_by) VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (coll, id) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [coll, id, JSON.stringify(data), by || null]);
}

/* ---------- log-in ---------- */
async function currentUser(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT a.id, a.email, a.name FROM sessions s JOIN accounts a ON a.id = s.account_id
     WHERE s.token = $1 AND s.expires_at > now() AND a.active`, [sha256(token)]);
  return rows[0] || null;
}
async function requireUser(req, res, next) {
  const user = await currentUser(req);
  if (!user) return next(httpError(401, 'revoked', 'Log in first'));
  req.user = user;
  next();
}

app.post('/api/login', async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const password = String((req.body && req.body.password) || '');
  const { rows } = await pool.query('SELECT id, email, name, password_hash, active FROM accounts WHERE email = $1', [email]);
  const account = rows[0];
  const ok = await bcrypt.compare(password, account ? account.password_hash : DUMMY_HASH);
  if (!account || !ok || !account.active) throw httpError(401, 'invalid_argument', 'Wrong email or password.');
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query('INSERT INTO sessions (token, account_id, expires_at) VALUES ($1, $2, now() + make_interval(hours => $3))',
    [sha256(token), account.id, SESSION_HOURS]);
  await pool.query('UPDATE accounts SET last_login = now() WHERE id = $1', [account.id]);
  // HttpOnly: page scripts cannot read the token. SameSite=Strict: other websites cannot send it.
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`);
  res.json({ id: account.id, email: account.email, name: account.name });
});

app.post('/api/logout', async (req, res) => {
  const token = readCookie(req, COOKIE);
  if (token) await pool.query('DELETE FROM sessions WHERE token = $1', [sha256(token)]);
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/me', requireUser, (req, res) => res.json(req.user));

/* ---------- people directory (used for the names shown in the app) ---------- */
app.get('/api/people', requireUser, async (req, res) => {
  if (req.query.ids !== undefined) {
    const ids = String(req.query.ids).split(',').filter(x => ID_RE.test(x)).slice(0, 200);
    const people = {};
    if (ids.length) {
      const { rows } = await pool.query('SELECT id, email, name FROM accounts WHERE id = ANY($1::text[])', [ids]);
      rows.forEach(r => { people[r.id] = { email: r.email, name: r.name }; });
    }
    return res.json({ people });
  }
  const q = String(req.query.q || '').trim().replace(/[\\%_]/g, c => '\\' + c);
  const { rows } = await pool.query(
    `SELECT id, email, name FROM accounts WHERE active AND (email ILIKE $1 OR name ILIKE $1) ORDER BY name LIMIT 8`,
    [`%${q}%`]);
  res.json({ people: rows });
});

/* ---------- documents (the app's database) ---------- */
app.get('/api/docs/:coll', requireUser, async (req, res) => {
  checkColl(req.params.coll);
  const { rows } = await pool.query('SELECT id, data FROM kv_docs WHERE coll = $1 ORDER BY id', [req.params.coll]);
  res.json({ docs: rows });
});

app.get('/api/docs/:coll/:id', requireUser, async (req, res) => {
  checkColl(req.params.coll); checkId(req.params.id);
  const { rows } = await pool.query('SELECT data FROM kv_docs WHERE coll = $1 AND id = $2', [req.params.coll, req.params.id]);
  res.json(rows.length ? { exists: true, data: rows[0].data } : { exists: false });
});

// body: { data, merge }  merge=false replaces the document, merge=true merges into it (the app's "update")
app.put('/api/docs/:coll/:id', requireUser, async (req, res) => {
  const { coll, id } = req.params;
  checkColl(coll); checkId(id);
  const data = req.body && req.body.data;
  if (!isPlain(data)) throw httpError(400, 'invalid_argument', 'data must be an object');
  await txn(async client => {
    let next = data;
    if (req.body.merge) {
      const { rows } = await client.query('SELECT data FROM kv_docs WHERE coll = $1 AND id = $2 FOR UPDATE', [coll, id]);
      if (rows.length) next = deepMerge(rows[0].data, data);
    }
    await upsert(client, coll, id, next, req.user.id);
  });
  broadcast(coll);
  res.json({ ok: true });
});

app.delete('/api/docs/:coll/:id', requireUser, async (req, res) => {
  const { coll, id } = req.params;
  checkColl(coll); checkId(id);
  await pool.query('DELETE FROM kv_docs WHERE coll = $1 AND id = $2', [coll, id]);
  broadcast(coll);
  res.json({ ok: true });
});

// Short lock used so two people never get the same document number (see allocNumber in index.html).
app.post('/api/lease', requireUser, async (req, res) => {
  const { coll, id, holder } = req.body || {};
  const ttl = Math.min(Math.max(Number((req.body || {}).ttlMs) || 30000, 1000), 600000);
  checkColl(String(coll || '')); checkId(String(id || ''));
  const now = Date.now();
  const acquired = await txn(async client => {
    // make sure the row exists and is locked before reading the lease
    await client.query(`INSERT INTO kv_docs (coll, id, data) VALUES ($1, $2, '{}'::jsonb) ON CONFLICT DO NOTHING`, [coll, id]);
    const { rows } = await client.query('SELECT data FROM kv_docs WHERE coll = $1 AND id = $2 FOR UPDATE', [coll, id]);
    const current = rows[0].data;
    const lease = current.__lease;
    if (lease && lease.until > now && lease.holder !== holder) return false;
    await upsert(client, coll, id, { ...current, __lease: { holder, until: now + ttl } }, req.user.id);
    return true;
  });
  res.json({ acquired, holder });
});

/* ---------- live updates: the browser is told when a collection changes ---------- */
const streams = new Set();
app.get('/api/events', requireUser, (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('retry: 3000\n\n');
  streams.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); streams.delete(res); });
});
function broadcast(coll) {
  const message = `event: change\ndata: ${JSON.stringify({ coll })}\n\n`;
  for (const res of streams) res.write(message);
}

/* ---------- the web page ---------- */
// index.html is served with one extra script tag so the page saves its data to this server.
const ADAPTER_TAG = '<script src="/server-adapter.js"></script>\n';
app.get(['/', '/index.html'], (req, res) => {
  let html = fs.readFileSync(path.join(APP_DIR, 'index.html'), 'utf8');
  html = html.replace('</head>', ADAPTER_TAG + '</head>');
  res.type('html').send(html);
});
app.get('/server-adapter.js', (req, res) => res.type('js').sendFile(path.join(CLIENT_DIR, 'server-adapter.js')));

/* ---------- errors ---------- */
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.status && err.status < 500) {
    console.warn(`${req.method} ${req.originalUrl} -> ${err.status} ${err.message}`);
    return res.status(err.status).json({ code: err.code || 'invalid_argument', error: err.message });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ code: 'invalid_argument', error: 'Bad request body' });
  console.error(err);
  res.status(503).json({ code: 'unavailable', error: 'Server error - see the server console' });
});

/* ---------- start ---------- */
async function main() {
  await applySchema(pool);
  const expire = () => pool.query('DELETE FROM sessions WHERE expires_at <= now()').catch(() => { });
  await expire();
  setInterval(expire, 3600000).unref();
  app.listen(PORT, HOST, () => console.log(`KUN MH server running at http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`));
}
main().catch(e => {
  console.error('Could not start the server:', e.message);
  console.error('Check the DB_* settings in server/.env and that PostgreSQL is running.');
  process.exit(1);
});
