'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROLES, DEFAULT_RIGHTS, COLLECTION_PAGE, canWrite, rightFor } = require('../src/permissions');

const INDEX_HTML = path.join(__dirname, '..', '..', 'index.html');

test('default rights match the MODULES table in index.html', () => {
  const src = fs.readFileSync(INDEX_HTML, 'utf8');
  const rows = [...src.matchAll(/\['([^']+)', '[^']*', '([EVH]{8})'\]/g)];
  assert.ok(rows.length >= 25, 'MODULES table not found in index.html');
  const fromApp = Object.fromEntries(rows.map(m => [m[1], m[2]]));
  for (const [page, rights] of Object.entries(DEFAULT_RIGHTS)) {
    assert.equal(rights, fromApp[page], `default rights differ for "${page}"`);
  }
});

test('the roles match ROLES in index.html', () => {
  const src = fs.readFileSync(INDEX_HTML, 'utf8');
  const m = src.match(/const DEFAULT_ROLES = (\[[^\]]+\]);/);
  assert.deepEqual(ROLES, JSON.parse(m[1].replace(/'/g, '"')));
});

test('Admin may write every collection, including cfg/access', () => {
  for (const collection of Object.keys(COLLECTION_PAGE)) {
    assert.equal(canWrite({ role: 'Admin', collection, access: null }), true, collection);
  }
});

test('GRN Officer may write GRNs but not items, vendors or bills', () => {
  assert.equal(canWrite({ role: 'GRN Officer', collection: 'm_grns', access: null }), true);
  assert.equal(canWrite({ role: 'GRN Officer', collection: 'm_items', access: null }), false);
  assert.equal(canWrite({ role: 'GRN Officer', collection: 'm_vendors', access: null }), false);
  assert.equal(canWrite({ role: 'GRN Officer', collection: 'm_bills', access: null }), false);
});

test('the access matrix and users follow the saved matrix (v2.2): Admin always; others only where the matrix says E', () => {
  // v2.2 gives the Internal Auditor edit rights on Users and Access. This is deliberate in v2.2 and
  // is flagged for review; the test records the current behaviour.
  assert.equal(canWrite({ role: 'Admin', collection: 'cfg/access', access: null }), true);
  for (const role of ROLES.filter(r => r !== 'Admin')) {
    const expected = { Users: rightFor('Users', role, null) === 'E', Access: rightFor('Access', role, null) === 'E' };
    assert.equal(canWrite({ role, collection: 'cfg/access', access: null }), expected.Access, role + ' access');
    assert.equal(canWrite({ role, collection: 'm_users', access: null }), expected.Users, role + ' users');
  }
  assert.equal(canWrite({ role: 'Internal Auditor', collection: 'm_users', access: null }), true, 'v2.2 Internal Auditor edits Users');
});

test('Internal Auditor may audit bills (Bills page is E for the auditor)', () => {
  assert.equal(canWrite({ role: 'Internal Auditor', collection: 'm_bills', access: null }), true);
});

test('a saved access matrix overrides the default', () => {
  const access = { Items: { 'GRN Officer': 'E' }, GRN: { 'GRN Officer': 'H' } };
  assert.equal(canWrite({ role: 'GRN Officer', collection: 'm_items', access }), true);
  assert.equal(canWrite({ role: 'GRN Officer', collection: 'm_grns', access }), false);
  assert.equal(rightFor('Items', 'GRN Officer', access), 'E');
  assert.equal(rightFor('Items', 'Accounts', access), 'V');   // not saved, so the default applies
});

test('a view-only right does not allow writes', () => {
  // Vendors is V for Sigat in the default matrix
  assert.equal(canWrite({ role: 'Sigat', collection: 'm_vendors', access: null }), false);
});

test('unknown collections are refused for every role except Admin', () => {
  assert.equal(canWrite({ role: 'Accounts', collection: 'm_secret', access: null }), false);
  assert.equal(canWrite({ role: 'Admin', collection: 'm_secret', access: null }), true);
});

test('accounts not linked to an in-app user cannot write business records', () => {
  assert.equal(canWrite({ role: null, collection: 'm_grns', access: null }), false);
  assert.equal(canWrite({ role: 'Store Keeper', collection: 'm_grns', access: null }), true, 'v2.2 Store Keeper enters GRNs');
  assert.equal(canWrite({ role: 'Stranger', collection: 'm_grns', access: null }), false, 'an unknown role is refused');
});

test('audit, notices, number log and locks are writable by any signed-in user', () => {
  for (const collection of ['m_audit', 'm_notifs', 'm_numlog', 'locks/num-PO-2026']) {
    assert.equal(canWrite({ role: 'HK Supervisor', collection, access: null }), true, collection);
    assert.equal(canWrite({ role: null, collection, access: null }), true, collection);
  }
});

/* ---------- read rules (A2 follow-up) ---------- */
const { canRead, READ_PAGES, ALWAYS_READ } = require('../src/permissions');

test('read: the pages named in the read rules all exist in the rights table', () => {
  for (const [coll, pages] of Object.entries(READ_PAGES)) {
    for (const page of pages) assert.ok(page in DEFAULT_RIGHTS, `${coll} names unknown page "${page}"`);
  }
});

test('read: every collection the app stores is either restricted by page or always readable', () => {
  for (const coll of Object.keys(COLLECTION_PAGE)) {
    const known = coll in READ_PAGES || ALWAYS_READ.has(coll) || coll.startsWith('cfg');
    assert.ok(known, `${coll} has no read rule`);
  }
});

test('read: HK Supervisor may not read bills, but may read items and users', () => {
  assert.equal(canRead({ role: 'HK Supervisor', collection: 'm_bills', access: null }), false);
  assert.equal(canRead({ role: 'HK Supervisor', collection: 'm_items', access: null }), true);
  assert.equal(canRead({ role: 'HK Supervisor', collection: 'm_users', access: null }), true);
  assert.equal(canRead({ role: 'HK Supervisor', collection: 'cfg/settings', access: null }), true);
});

test('read: GRN Officer may read GRNs and, through the PO Register view, bills', () => {
  assert.equal(canRead({ role: 'GRN Officer', collection: 'm_grns', access: null }), true);
  assert.equal(canRead({ role: 'GRN Officer', collection: 'm_bills', access: null }), true);
});

test('read: a role hidden from every page that uses a collection is refused', () => {
  // HK Supervisor: Advances, Advance Print, PO Register, Bills, Payment Pack and Dashboard are all H
  assert.equal(canRead({ role: 'HK Supervisor', collection: 'm_advances', access: null }), false);
  // Accounts: PPM AMC is H, but the Dashboard (V) uses the same records
  assert.equal(canRead({ role: 'Accounts', collection: 'm_ppm', access: null }), true);
});

test('read: accounts not linked to an in-app user are refused restricted collections', () => {
  assert.equal(canRead({ role: null, collection: 'm_grns', access: null }), false);
  assert.equal(canRead({ role: null, collection: 'm_items', access: null }), true);
});

/* ---------- editable role list (version 2.2) ---------- */
test('a custom role may write only where its saved rights say E', () => {
  const roles = [...ROLES, 'Store Auditor'];
  const access = { Items: { 'Store Auditor': 'E' }, Vendors: { 'Store Auditor': 'V' } };
  assert.equal(canWrite({ role: 'Store Auditor', collection: 'm_items', access, roles }), true);
  assert.equal(canWrite({ role: 'Store Auditor', collection: 'm_vendors', access, roles }), false, 'view only');
  assert.equal(canWrite({ role: 'Store Auditor', collection: 'm_grns', access, roles }), false, 'hidden by default');
});

test('a role that is not in the stored list is refused, even if the access matrix mentions it', () => {
  const access = { Items: { Ghost: 'E' } };
  assert.equal(canWrite({ role: 'Ghost', collection: 'm_items', access, roles: ROLES }), false);
  assert.equal(canRead({ role: 'Ghost', collection: 'm_bills', access, roles: ROLES }), false);
});

test('a custom role reads a restricted collection when one of its pages is visible', () => {
  const roles = [...ROLES, 'Store Auditor'];
  const access = { Bills: { 'Store Auditor': 'V' } };
  assert.equal(canRead({ role: 'Store Auditor', collection: 'm_bills', access, roles }), true);
  assert.equal(canRead({ role: 'Store Auditor', collection: 'm_grns', access: {}, roles }), false);
});

test('the role list is an Access page setting: cfg/roles is writable by Admin only', () => {
  assert.equal(canWrite({ role: 'Admin', collection: 'cfg/roles', access: null }), true);
  assert.equal(canWrite({ role: 'Accounts', collection: 'cfg/roles', access: null }), false);
});
