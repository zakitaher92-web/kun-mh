'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setAllAvl } = require('../src/approve-vendors');

test('every vendor becomes approved; the others are left as they are', () => {
  const rows = {
    'V-0001': { o: 0, r: { code: 'V-0001', name: 'SAH Electricals', avl: 'N', bank: '' } },
    'V-0002': { o: 1, r: { code: 'V-0002', name: 'Saif Al Shimri', avl: 'Y', bank: '' } },
  };
  const out = setAllAvl(rows);
  assert.equal(out.total, 2);
  assert.equal(out.changed, 1);
  assert.equal(out.rows['V-0001'].r.avl, 'Y');
  assert.equal(out.rows['V-0002'].r.avl, 'Y');
  assert.equal(out.rows['V-0001'].r.name, 'SAH Electricals', 'other fields are kept');
  assert.equal(out.rows['V-0001'].o, 0, 'the order is kept');
  assert.equal(rows['V-0001'].r.avl, 'N', 'the input is not changed');
});

test('an empty vendor list gives an empty result', () => {
  assert.deepEqual(setAllAvl({}).rows, {});
  assert.equal(setAllAvl(undefined).total, 0);
});
