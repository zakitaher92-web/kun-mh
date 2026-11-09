'use strict';
// Tests for the calculation rules in rules.js (approval matrix, PO type, tolerances, cash PV, advances).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const R = require('../../rules.js');

// Thresholds as saved in Settings (MH-01) for a new install.
const ST = { poFrom: 500000, qcpoAbove: 7500000, masoolLimit: 5000000, masoolHoaLimit: 25000000 };
const MASOOL = 'Maintenance Masool';
const MASOOL_HOA = 'Masool + Head of Accounts';
const MASOOL_HOA_SIGAT = 'Masool + Head of Accounts + Sigat';

test('approval: each amount band and the exact limits', () => {
  assert.equal(R.approvalFor(1, ST), MASOOL);
  assert.equal(R.approvalFor(5000000, ST), MASOOL, 'exactly the Masool limit is still Masool');
  assert.equal(R.approvalFor(5000001, ST), MASOOL_HOA);
  assert.equal(R.approvalFor(25000000, ST), MASOOL_HOA, 'exactly the HoA limit is still Masool + HoA');
  assert.equal(R.approvalFor(25000001, ST), MASOOL_HOA_SIGAT);
});

test('PO type: below the PO limit, PO, and PO-cum-Quotation above its limit', () => {
  assert.equal(R.docTypeFor(499999, ST), 'PO (below PO limit)');
  assert.equal(R.docTypeFor(500000, ST), 'PO');
  assert.equal(R.docTypeFor(7500000, ST), 'PO', 'exactly the quotation limit is still a PO');
  assert.equal(R.docTypeFor(7500001, ST), 'PO-cum-Quotation');
});

test('price approval: only when a line is above the MPL tolerance', () => {
  assert.equal(R.priceApprovalFor(1000000, false, ST), '');
  assert.equal(R.priceApprovalFor(5000000, true, ST), 'Head of Accounts');
  assert.equal(R.priceApprovalFor(5000001, true, ST), 'Sigat');
});

test('variance: needs approval only when more than the tolerance over', () => {
  assert.equal(R.needsVarianceApproval(0, 0, 0.1), false);
  assert.equal(R.needsVarianceApproval(0.1, 0.1, 0.1), false, 'exactly 10 % is allowed');
  assert.equal(R.needsVarianceApproval(0.1000001, 0, 0.1), true);
  assert.equal(R.needsVarianceApproval(0, 0.2, 0.1), true, 'over the PO value counts too');
  assert.equal(R.needsVarianceApproval(Infinity, 0, 0.1), true, 'billed with nothing received');
});

test('cash PV: a bill qualifies only if it is above zero and within the limit', () => {
  assert.equal(R.cashPvEligible(0, 5000000), false);
  assert.equal(R.cashPvEligible(1, 5000000), true);
  assert.equal(R.cashPvEligible(5000000, 5000000), true, 'exactly the limit qualifies');
  assert.equal(R.cashPvEligible(5000001, 5000000), false);
});

test('advance status: unpaid, adjusted, overdue, being adjusted', () => {
  assert.equal(R.advanceStatus(null, 100, null, 30), 'Not paid yet');
  assert.equal(R.advanceStatus('2026-10-01', 0.5, 5, 30), 'Adjusted', 'balance of 0.5 or less is adjusted');
  assert.equal(R.advanceStatus('2026-10-01', 100, 31, 30), 'Not adjusted - follow up');
  assert.equal(R.advanceStatus('2026-10-01', 100, 30, 30), 'Being adjusted', 'exactly the window is still in time');
});

test('bill payment status: one rule for the register and the dashboard', () => {
  assert.equal(R.billPayStatus({ payDate: '2026-11-01', audit: 'Clear' }), 'Paid');
  assert.equal(R.billPayStatus({ audit: 'Clear' }), 'Cleared - awaiting payment');
  assert.equal(R.billPayStatus({ audit: 'Hold' }), 'On hold');
  assert.equal(R.billPayStatus({ audit: 'Query' }), 'Query');
  assert.equal(R.billPayStatus({}), 'Awaiting audit');
});

test('the page uses the module, not its own copy of the rules', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  assert.match(html, /<script src="rules\.js"><\/script>/, 'rules.js is loaded by the page');
  for (const fn of ['approvalFor', 'docTypeFor', 'priceApprovalFor', 'needsVarianceApproval', 'cashPvEligible', 'advanceStatus', 'billPayStatus']) {
    assert.match(html, new RegExp('KUNRules\\.' + fn + '\\('), `page calls ${fn}`);
  }
  assert.doesNotMatch(html, /v <= num\(st\.masoolLimit\)/, 'old inline approval rule is gone');
});

test('backup: staff contact details are left out; the business records are kept', () => {
  const data = {
    users: [{ id: 'HOA', name: 'Head of Accounts', role: 'Admin', email: 'hoa@x.test', phone: '070000', contact: 'office', active: 'Y' }],
    pos: [{ no: 'KBL/MH/PO/2026/0003', vendor: 'SAH Electricals' }],
    settings: { poFrom: 500000 },
  };
  const out = R.stripStaffContacts(data);
  assert.equal(out.users[0].email, undefined);
  assert.equal(out.users[0].phone, undefined);
  assert.equal(out.users[0].contact, undefined);
  assert.equal(out.users[0].role, 'Admin', 'role and name are kept');
  assert.equal(out.pos[0].vendor, 'SAH Electricals');
  assert.equal(out.settings.poFrom, 500000);
  assert.match(out.backupNote, /not included/);
  assert.equal(data.users[0].email, 'hoa@x.test', 'the original data is not changed');
});

test('backup: the page writes the backup through the module', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  assert.match(html, /KUNRules\.stripStaffContacts\(S\)/);
});
