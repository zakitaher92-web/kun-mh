'use strict';
// Route tests for the server: log-in, sessions, write permissions, lock-out and the audit trail.
// They run the real Express app on a fake database (see fake-pool.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createFakePool, hash } = require('../testing/fake-pool');

const PASSWORD = 'correct-horse';

function seedPool(extra = {}) {
  return createFakePool({
    accounts: [
      { id: 'a-grn', email: 'grn@example.test', name: 'GRN Officer', password_hash: hash(PASSWORD) },
      { id: 'a-adm', email: 'admin@example.test', name: 'Head of Accounts', password_hash: hash(PASSWORD) },
      { id: 'a-none', email: 'nobody@example.test', name: 'Not linked', password_hash: hash(PASSWORD) },
      { id: 'a-off', email: 'off@example.test', name: 'Inactive', password_hash: hash(PASSWORD), active: false },
    ],
    kv: {
      'm_users|all': {
        rows: {
          GRN1: { o: 0, r: { id: 'GRN1', name: 'GRN Officer', role: 'GRN Officer', cid: 'a-grn', active: true } },
          ADM: { o: 1, r: { id: 'ADM', name: 'Head of Accounts', role: 'Admin', cid: 'a-adm', active: true } },
        },
      },
      'm_items|c00': { rows: { ITM1: { o: 0, r: { code: 'ITM1', name: 'Soap' } } } },
      'm_grns|KBL-GRN-1': { no: 'KBL-GRN-1' },
      'm_bills|KBL-BILL-1': { no: 'KBL-BILL-1', amount: 100 },
      ...(extra.kv || {}),
    },
  });
}

// Starts the app on a random local port. Returns { base, pool, close }.
async function start(pool, options = {}) {
  const { app } = createApp(pool, { cookieSecure: false, ...options });
  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, pool, close: () => new Promise(r => server.close(r)) };
}

async function login(base, email, password = PASSWORD) {
  const res = await fetch(base + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return { res, cookie, setCookie: res.headers.get('set-cookie') || '' };
}

async function call(base, method, url, { cookie, body } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function withServer(pool, fn, options) {
  const srv = await start(pool, options);
  try { await fn(srv); } finally { await srv.close(); }
}

test('requests without a session are refused (401)', async () => {
  await withServer(seedPool(), async ({ base }) => {
    const r = await call(base, 'GET', '/api/docs/m_items');
    assert.equal(r.status, 401);
    assert.equal(r.json.code, 'revoked');
  });
});

test('log-in succeeds, sets an HttpOnly SameSite cookie and records the log-in', async () => {
  const pool = seedPool();
  await withServer(pool, async ({ base }) => {
    const { res, setCookie } = await login(base, 'grn@example.test');
    assert.equal(res.status, 200);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.doesNotMatch(setCookie, /Secure/, 'Secure is off until HTTPS is used');
    const audit = pool.state.kv.get('m_audit|' + currentMonth());
    const entries = Object.values(audit.rows).map(x => x.r.action);
    assert.ok(entries.includes('Log in'), 'the log-in is in the audit log');
  });
});

test('the cookie is marked Secure when COOKIE_SECURE is on', async () => {
  await withServer(seedPool(), async ({ base }) => {
    const { setCookie } = await login(base, 'grn@example.test');
    assert.match(setCookie, /; Secure/);
  }, { cookieSecure: true });
});

test('a wrong password is refused and the failed attempt is recorded without the password', async () => {
  const pool = seedPool();
  await withServer(pool, async ({ base }) => {
    const { res } = await login(base, 'grn@example.test', 'wrong-password');
    assert.equal(res.status, 401);
    const audit = pool.state.kv.get('m_audit|' + currentMonth());
    const failed = Object.values(audit.rows).map(x => x.r).filter(r => r.action === 'Failed log-in');
    assert.equal(failed.length, 1);
    assert.equal(failed[0].details, 'Wrong email or password');
    assert.ok(!JSON.stringify(audit).includes('wrong-password'), 'the password is never written to the log');
  });
});

test('three wrong passwords lock the email for 30 seconds', async () => {
  await withServer(seedPool(), async ({ base }) => {
    for (let i = 0; i < 3; i++) await login(base, 'grn@example.test', 'nope');
    const locked = await login(base, 'grn@example.test');          // even the right password waits
    assert.equal(locked.res.status, 429);
  });
});

test('an inactive account cannot log in', async () => {
  await withServer(seedPool(), async ({ base }) => {
    const { res } = await login(base, 'off@example.test');
    assert.equal(res.status, 401);
  });
});

test('reads are open to any signed-in user', async () => {
  await withServer(seedPool(), async ({ base }) => {
    const { cookie } = await login(base, 'grn@example.test');
    const r = await call(base, 'GET', '/api/docs/m_items', { cookie });
    assert.equal(r.status, 200);
    assert.equal(r.json.docs.length, 1);
  });
});

test('GRN Officer may write GRNs', async () => {
  await withServer(seedPool(), async ({ base, pool }) => {
    const { cookie } = await login(base, 'grn@example.test');
    const r = await call(base, 'PUT', '/api/docs/m_grns/KBL-GRN-2', { cookie, body: { data: { no: 'KBL-GRN-2' } } });
    assert.equal(r.status, 200);
    assert.ok(pool.state.kv.has('m_grns|KBL-GRN-2'));
  });
});

test('GRN Officer may NOT change items (refused with 403, nothing saved)', async () => {
  const pool = seedPool();
  await withServer(pool, async ({ base }) => {
    const { cookie } = await login(base, 'grn@example.test');
    const before = JSON.stringify(pool.state.kv.get('m_items|c00'));
    const r = await call(base, 'PUT', '/api/docs/m_items/c00', { cookie, body: { data: { rows: {} } } });
    assert.equal(r.status, 403);
    assert.equal(r.json.code, 'forbidden');
    assert.equal(JSON.stringify(pool.state.kv.get('m_items|c00')), before);
  });
});

test('GRN Officer may NOT change the access matrix or delete bills', async () => {
  await withServer(seedPool(), async ({ base }) => {
    const { cookie } = await login(base, 'grn@example.test');
    const access = await call(base, 'PUT', '/api/docs/cfg/access', { cookie, body: { data: { v: { Access: { 'GRN Officer': 'E' } } } } });
    assert.equal(access.status, 403);
    const del = await call(base, 'DELETE', '/api/docs/m_bills/KBL-BILL-1', { cookie });
    assert.equal(del.status, 403);
  });
});

test('Admin may change the access matrix', async () => {
  await withServer(seedPool(), async ({ base }) => {
    const { cookie } = await login(base, 'admin@example.test');
    const r = await call(base, 'PUT', '/api/docs/cfg/access', { cookie, body: { data: { v: {} } } });
    assert.equal(r.status, 200);
  });
});

test('a saved access matrix gives a role write rights on a page it could not change before', async () => {
  const pool = seedPool({ kv: { 'cfg|access': { v: { Items: { 'GRN Officer': 'E' } } } } });
  await withServer(pool, async ({ base }) => {
    const { cookie } = await login(base, 'grn@example.test');
    const r = await call(base, 'PUT', '/api/docs/m_items/c00', { cookie, body: { data: { rows: {} } } });
    assert.equal(r.status, 200);
  });
});

test('an account not linked to an in-app user cannot change business records', async () => {
  await withServer(seedPool(), async ({ base }) => {
    const { cookie } = await login(base, 'nobody@example.test');
    const r = await call(base, 'PUT', '/api/docs/m_grns/KBL-GRN-9', { cookie, body: { data: { no: 'x' } } });
    assert.equal(r.status, 403);
  });
});

test('audit entries and number locks can be written by any signed-in user', async () => {
  await withServer(seedPool(), async ({ base }) => {
    const { cookie } = await login(base, 'nobody@example.test');
    const audit = await call(base, 'PUT', '/api/docs/m_audit/' + currentMonth(), { cookie, body: { data: { rows: {} } } });
    assert.equal(audit.status, 200);
    const lease = await call(base, 'POST', '/api/lease', { cookie, body: { coll: 'locks', id: 'num-PO-2026', holder: 'tab1' } });
    assert.equal(lease.status, 200);
    assert.equal(lease.json.acquired, true);
  });
});

test('deleting a document needs the same rights as writing it', async () => {
  await withServer(seedPool(), async ({ base }) => {
    const { cookie } = await login(base, 'grn@example.test');
    const r = await call(base, 'DELETE', '/api/docs/m_grns/KBL-GRN-1', { cookie });
    assert.equal(r.status, 200);
  });
});

test('an unknown collection is refused for a non-Admin, and a bad name is a 400', async () => {
  await withServer(seedPool(), async ({ base }) => {
    const { cookie } = await login(base, 'grn@example.test');
    assert.equal((await call(base, 'PUT', '/api/docs/m_secret/x', { cookie, body: { data: {} } })).status, 403);
    assert.equal((await call(base, 'PUT', '/api/docs/Bad%21Name/x', { cookie, body: { data: {} } })).status, 400);
  });
});

test('only the Admin may reset another log-in password', async () => {
  await withServer(seedPool(), async ({ base }) => {
    const grn = await login(base, 'grn@example.test');
    const denied = await call(base, 'POST', '/api/admin/reset-password', { cookie: grn.cookie, body: { accountId: 'a-none', password: 'new-password-1' } });
    assert.equal(denied.status, 403);
    const adm = await login(base, 'admin@example.test');
    const ok = await call(base, 'POST', '/api/admin/reset-password', { cookie: adm.cookie, body: { accountId: 'a-none', password: 'new-password-1' } });
    assert.equal(ok.status, 200);
  });
});

test('log-out ends the session', async () => {
  await withServer(seedPool(), async ({ base }) => {
    const { cookie } = await login(base, 'grn@example.test');
    assert.equal((await call(base, 'GET', '/api/me', { cookie })).status, 200);
    await call(base, 'POST', '/api/logout', { cookie });
    assert.equal((await call(base, 'GET', '/api/me', { cookie })).status, 401);
  });
});

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

test('with devUser set (local test server only) every request acts as that user, without log-in', async () => {
  const devUser = { id: 'a-adm', email: 'admin@example.test', name: 'Head of Accounts' };
  await withServer(seedPool(), async ({ base }) => {
    const me = await call(base, 'GET', '/api/me');
    assert.equal(me.status, 200);
    assert.equal(me.json.id, 'a-adm');
    const w = await call(base, 'PUT', '/api/docs/cfg/access', { body: { data: { v: {} } } });
    assert.equal(w.status, 200, 'the dev user is Admin, so it may change the access matrix');
  }, { devUser });
});

test('without devUser the production rule holds: no session means 401', async () => {
  await withServer(seedPool(), async ({ base }) => {
    assert.equal((await call(base, 'GET', '/api/me')).status, 401);
  });
});
