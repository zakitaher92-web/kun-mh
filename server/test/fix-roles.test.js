'use strict';
// Tests for the phase 1 role fix (src/fix-roles-1.9.js), run on the fake database.
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyRoles, CHANGES } = require('../src/fix-roles-1.9');
const { createFakePool } = require('../testing/fake-pool');

function usersPool(roles) {
  const rows = {};
  Object.entries(roles).forEach(([id, role], i) => {
    rows[id] = { o: i, r: { id, name: id, role, active: true } };
  });
  return createFakePool({ kv: { 'm_users|all': { rows } } });
}

async function run(pool, changes) {
  const client = await pool.connect();
  return applyRoles(client, changes, new Date(2026, 10, 9, 10, 0));
}

test('the four people who were wrongly Admin are set to their roles', async () => {
  const pool = usersPool({ SIGAT1: 'Admin', SIGAT2: 'Admin', TZAKI: 'Admin', TGHADIALI: 'Admin', HOA: 'Admin' });
  const { changed, skipped } = await run(pool);
  assert.deepEqual(changed.map(c => [c.id, c.to]), [
    ['SIGAT1', 'Sigat'], ['SIGAT2', 'Sigat'], ['TZAKI', 'Internal Auditor'], ['TGHADIALI', 'Internal Auditor'],
  ]);
  assert.deepEqual(skipped, []);
  const saved = pool.state.kv.get('m_users|all').rows;
  assert.equal(saved.SIGAT1.r.role, 'Sigat');
  assert.equal(saved.TZAKI.r.role, 'Internal Auditor');
  assert.equal(saved.HOA.r.role, 'Admin', 'the Head of Accounts keeps Admin');
});

test('a person who already has another role is not changed', async () => {
  const pool = usersPool({ SIGAT1: 'Accounts', SIGAT2: 'Admin', TZAKI: 'Internal Auditor', TGHADIALI: 'Admin' });
  const { changed, skipped } = await run(pool);
  assert.ok(skipped.includes('SIGAT1 has role "Accounts" - not changed'));
  assert.ok(skipped.includes('TZAKI already Internal Auditor'));
  assert.equal(pool.state.kv.get('m_users|all').rows.SIGAT1.r.role, 'Accounts');
  assert.deepEqual(changed.map(c => c.id), ['SIGAT2', 'TGHADIALI']);
});

test('each change is written to the audit log', async () => {
  const pool = usersPool({ SIGAT1: 'Admin', SIGAT2: 'Admin', TZAKI: 'Admin', TGHADIALI: 'Admin' });
  await run(pool);
  const audit = pool.state.kv.get('m_audit|2026-11').rows;
  const entries = Object.values(audit).map(x => x.r);
  assert.equal(entries.length, 4);
  assert.ok(entries.every(e => e.action === 'User updated'));
  assert.ok(entries.some(e => e.details.includes('SIGAT1 Sigat') && e.details.includes('role was Admin')));
});

test('a missing user stops the change with an error', async () => {
  const pool = usersPool({ SIGAT1: 'Admin' });
  await assert.rejects(run(pool), /User not found: SIGAT2/);
});

test('an unknown target role is refused before anything is read', async () => {
  const pool = usersPool({ SIGAT1: 'Admin' });
  await assert.rejects(run(pool, [{ id: 'SIGAT1', role: 'Superuser' }]), /Unknown role: Superuser/);
});

test('the built-in change list uses roles the app knows', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
  const roles = JSON.parse(src.match(/const ROLES = (\[[^\]]+\]);/)[1].replace(/'/g, '"'));
  for (const c of CHANGES) assert.ok(roles.includes(c.role), c.role);
});
