'use strict';
// Converts the version 2.2 data file (seed.json, standalone workbook) into the documents the server
// version stores in the database (kv_docs), and writes a SQL file that replaces the data in Neon.
//
// Usage (in the server folder):
//   node src/convert-v22.js "<path to seed.json>" "<output folder>" [--account-id <id>]
// Writes: v22-docs.json (the documents, for the local test server) and neon-v22-load.sql.
// Passwords and bank details are not in the source; staff e-mail addresses are not carried over.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Fixed ID of the staging Head of Accounts log-in (created by the staging set-up SQL).
const DEFAULT_ACCOUNT_ID = 'a30e662d-ef05-4737-8184-9a34d6e140a4';
const MASTER_TEMPLATE = path.join(__dirname, '..', '..', '..', 'dist', 'KUN-MH-masters-1.9.json');

const ROLES = ['Admin', 'Sigat', 'Internal Auditor', 'Maintenance Masool', 'GRN Officer', 'HK Supervisor', 'Accounts', 'Store Keeper'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Server page name -> version 2.2 page name, where they differ. Pages not in v2.2 keep their current rights.
const PAGE_ALIAS = { 'MPL': 'Items' };

// The same key rule as the server version (index.html: sid, chunkOf, recKey).
const sid = s => String(s || 'x').replace(/[^A-Za-z0-9_\-.~:@+]/g, '-');
const REC = { pos: 'no', advances: 'no', grns: 'no', srns: 'no', bills: 'no', issues: 'no', jobs: 'no', numlog: 'no', laundry: 'id', ppm: 'id', users: 'id', items: 'code', vendors: 'code', audit: 'k', notifs: 'id' };
function chunkOf(coll, r) {
  const m = /\/(\d{4})\/(\d{4})$/.exec(r.no || '');
  if (m) return (coll === 'numlog' ? sid(r.type) + '-' : '') + m[1] + '-' + Math.floor(+m[2] / 100);
  if (coll === 'laundry') return sid(String(r.date || 'x').slice(0, 7));
  if (coll === 'audit') return sid(String(r.t || 'x').slice(0, 7));
  return 'all';
}
const recKey = (coll, r) => sid(r[REC[coll]]);

function build(seed, accountId) {
  const master = JSON.parse(fs.readFileSync(MASTER_TEMPLATE, 'utf8'));
  const base = id => master.docs.find(d => d.coll === 'cfg' && d.id === id).data.v;
  const docs = [];                                   // { coll, id, data }
  const cfg = (id, v) => docs.push({ coll: 'cfg', id, data: { v } });
  const notes = [];                                  // what was converted, for the report

  // ---- settings: the 1.9 defaults, overridden by version 2.2 values
  const st = { ...base('settings') };
  const g = seed.cfg.general, t = seed.cfg.thr;
  Object.assign(st, {
    year: g.year, month: MONTHS.indexOf(g.month) + 1 || 11, capacity: g.capacity, prefix: g.prefix,
    stockOpenDate: g.stockDate, fx: g.fx, cpvMax: g.cpvMax,
    poFrom: t.poMin, qcpoAbove: t.qLimit, minQuotes: t.minQ, masoolLimit: t.limM, masoolHoaLimit: t.limH,
    priceTol: t.priceTol, maxAdv: t.advMax, budgetWarn: t.budWarn, hkTol: t.normTol,
    jobNormalDays: t.jobDays, ppmWindow: t.ppmWin, amcWarn: t.amcWin, advDays: t.advDays, billTol: t.billTol,
    occupancy: seed.cfg.months.map(m => ({ plan: m.occ, actual: m.actual > 0 ? m.actual : null })),
    locked: true, approvalHash: null, reportDate: '',
  });
  cfg('settings', st);

  // ---- lists: the 1.9 lists, overridden by version 2.2 where the names match
  const L = { ...base('lists') }, S2 = seed.cfg.lists;
  Object.assign(L, { units: S2.units, freqs: S2.freq, doneBy: S2.doneBy, trades: S2.trades, priorities: S2.priorities,
    payModes: S2.payModes, issuedTo: S2.issuedTo, vendorTypes: S2.vtypes });
  cfg('lists', L);

  cfg('categories', seed.cfg.categories.map(c => ({ name: c.name, line: c.bl, type: c.type })));
  cfg('budgetLines', seed.cfg.budgetLines.map(b => ({ code: b.code, name: b.name, basis: b.basis, annual: b.annual })));

  // ---- access matrix: the 8 roles of version 2.2, for every page of the server version
  // the page rights (MODULES in index.html) are the single source; v2.2 values are used where the page exists
  const pageSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  const block = pageSrc.match(/const MODULES = \[([\s\S]*?)\];/)[1];
  const modules = [...block.matchAll(/\['([^']+)', '[^']*', '([EVH]{8})'\]/g)].map(x => ({ name: x[1], new8: x[2] }));
  const access = {};
  for (const m of modules) {
    const src = PAGE_ALIAS[m.name] || m.name;
    access[m.name] = {};
    ROLES.forEach((role, i) => {
      const v22 = seed.cfg.access[src] && seed.cfg.access[src][role];
      access[m.name][role] = v22 || m.new8[i];
    });
  }
  cfg('access', access);
  // the editable role list (version 2.2): the roles and the base role each special role acts as
  cfg('roles', { list: seed.cfg.roles, base: seed.cfg.roleBase || {} });

  // ---- MPL (version 2.2): each item carries its own rate (mpl proposed, appr approved); no separate rows
  cfg('mpl', { status: 'Draft', version: 0, validUntil: '2027-03-31', rows: [] });
  cfg('counts', {}); cfg('linenCounts', {}); cfg('hkExplain', {});
  cfg('meta', { app: 'KUN-MH', version: '2.2', ownerUid: accountId, source: 'version 2.2 seed', created: new Date().toISOString() });

  // ---- master lists (one document each, rows keyed by code)
  const rowsOf = (coll, list, key, mapFn) => {
    const rows = {}; list.forEach((x, i) => { rows[sid(x[key])] = { o: i, r: mapFn(x) }; });
    docs.push({ coll, id: 'all', data: { rows } });
  };
  rowsOf('m_items', seed.items, 'code', i => ({ ex: false, code: i.code, name: i.name, cat: i.cat, unit: i.unit,
    reorder: null, opening: 0, par: null, norm: null, remarks: i.rem || '',
    pref: i.pref || '', basis: i.basis || '', mpl: i.mpl ?? null, appr: i.appr ?? null, prev: null, apprBy: i.apprBy || '', apprOn: i.apprOn || '' }));
  rowsOf('m_vendors', seed.vendors, 'code', v => ({ ex: false, code: v.code, name: v.name, type: v.type, supplies: v.supplies,
    contact: '', phone: '', avl: v.avl, bank: '', remarks: v.rem || '' }));
  rowsOf('m_users', seed.users, 'id', u => ({ id: u.id, cid: u.id === 'HOA' ? accountId : '', name: u.name, role: u.role,
    desig: u.desig || '', active: u.active ? 'Y' : 'N', reqCid: '', contact: '', lastLogin: '', mustChange: !!u.mustChange, remarks: u.remarks || '' }));

  // ---- transactions, chunked the way the server version does it
  const chunked = (coll, list, mapFn, keyFn) => {
    const chunks = {};
    list.forEach((x, i) => {
      const r = mapFn(x, i);
      const ch = chunkOf(coll, r);
      (chunks[ch] = chunks[ch] || { rows: {} }).rows[keyFn ? keyFn(r) : recKey(coll, r)] = { o: i, r };
    });
    Object.entries(chunks).forEach(([id, data]) => docs.push({ coll: 'm_' + coll, id, data }));
  };
  const lineMap = l => ({ item: l.item, qty: l.qty, rate: l.rate, spec: l.rem || '' });
  chunked('pos', seed.pos, p => ({
    ex: false, no: p.no, date: p.date, vendor: p.vendor, line: p.bl, subject: p.subject, delivery: p.delivery || '',
    place: p.place || '', mode: p.mode || 'Cash', adv: p.adv || 0, del: p.del || 0, ret: p.ret || 0, retDays: p.retDays ?? null,
    credit: p.credit || 0, other: p.other || '', quotes: (p.quotes || []).map(q => ({ v: q.vendor || '', a: q.amount === '' || q.amount == null ? null : Number(q.amount) })),
    l1reason: p.reason || '', budgetBy: p.budgetBy || '', approvedBy: p.approvedBy || '', approvalDate: p.approvalDate || '',
    cancel: !!p.cancel, remarks: p.remarks || '', emergency: false, closedOn: p.closedOn || '', closedBy: p.closedBy || '',
    shortClosed: false, shortReason: '', lines: (p.lines || []).map(lineMap),
  }));
  chunked('grns', seed.grns, g2 => ({ ex: false, no: g2.no, date: g2.date, po: g2.po, challan: g2.challan || '', by: g2.recBy || '',
    remarks: '', lines: (g2.lines || []).map(l => ({ item: l.item, recd: l.rec, acc: l.acc, remarks: l.rem || '' })) }));
  chunked('srns', seed.srns, s => ({ ex: false, no: s.no, date: s.date, po: s.po, from: s.from || '', to: s.to || '', location: s.place || '',
    prepBy: s.prepBy || '', confBy: s.confirmBy || '', remarks: s.rem || '', lines: (s.lines || []).map(l => ({ item: l.item, qty: l.qty })) }));
  chunked('bills', seed.bills, b => ({ ex: false, no: b.no, date: b.submitted, invNo: b.invNo || '', invDate: b.invDate || '', po: b.po || '',
    vendor: b.vendor || '', line: b.bl || '', refs: b.refs || '', amount: b.amount, advAdj: 0, otherDed: b.otherDed || 0,
    audit: b.audit || '', auditRemarks: b.auditRem || '', auditDate: b.auditDate || '', pv: b.pv || '', payDate: b.payDate || '',
    payRef: b.payRef || '', desc: b.desc || '', mode: '', checks: {}, varBy: b.varBy || '', varDate: b.varDate || '',
    varRem: b.varRem || '', clearedBy: b.clearedBy || '', cpv: b.cpv || '', cpvOn: b.cpvOn || '', varAsked: !!b.varAsked,
    // bill line items from version 2.2 (kept in the data; the server screens do not show them yet)
    lines: (b.lines || []).map(l => ({ po: l.po || '', line: l.line ?? '', item: l.item || '', uom: l.uom || '', qty: l.qty, rate: l.rate, rem: l.rem || '', ref: l.ref || '' })) }));
  // number log: the server version's record is { type, seq, no, t, by }
  chunked('numlog', seed.numlog, n => {
    const m = /(\d{4})$/.exec(n.num || ''); return { type: n.kind, seq: m ? +m[1] : 0, no: n.num, t: n.on || '', by: n.by || '', reg: n.reg || '' };
  });
  // audit log: keyed by time plus a sequence number, chunked by month
  chunked('audit', seed.audit, (a, i) => ({ k: String(a.t || '').replace(/\D/g, '').slice(0, 14) + '-' + String(i).padStart(4, '0'), t: a.t, user: a.user || '', action: a.action || '', details: a.details || '' }),
    r => sid(r.k));
  // notices: the e-mail addresses are not carried over; the notice is kept in the app only
  chunked('notifs', seed.notifs, (n, i) => ({ id: 'v22-' + String(i).padStart(4, '0'), t: n.t, event: n.event, ref: '', to: n.to || [], toNames: n.toNames || '',
    text: [n.subject, n.msg].filter(Boolean).join(' - '), status: 'Logged (no e-mail server)', done: false, doneBy: '', doneOn: '' }));

  return { docs, notes };
}

function sqlFor(docs, accountId) {
  const lines = [];
  lines.push('-- KUN MH - load of version 2.2 data into the staging database (run in the Neon SQL Editor).');
  lines.push('-- Replaces ALL documents (masters and transactions). Log-ins are kept. Run once.');
  lines.push('BEGIN;');
  lines.push('DELETE FROM kv_docs;');
  for (const d of docs) {
    const json = JSON.stringify(d.data);
    if (json.includes('$j$')) throw new Error('data contains the quote tag $j$');
    lines.push(`INSERT INTO kv_docs (coll, id, data, updated_by) VALUES ('${d.coll}', '${d.id.replace(/'/g, "''")}', $j$${json}$j$::jsonb, 'v22-load');`);
  }
  lines.push(`-- Head of Accounts log-in stays linked to the staging account ${accountId}`);
  lines.push('COMMIT;');
  lines.push("SELECT coll, count(*) AS documents FROM kv_docs GROUP BY coll ORDER BY coll;");
  return lines.join('\n') + '\n';
}

function main() {
  const [seedPath, outDir, ...rest] = process.argv.slice(2);
  if (!seedPath || !outDir) { console.log('Usage: node src/convert-v22.js <seed.json> <output folder> [--account-id <id>]'); process.exit(1); }
  const idx = rest.indexOf('--account-id');
  const accountId = idx >= 0 ? rest[idx + 1] : DEFAULT_ACCOUNT_ID;
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const { docs } = build(seed, accountId);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'v22-docs.json'), JSON.stringify(docs));
  fs.writeFileSync(path.join(outDir, 'neon-v22-load.sql'), sqlFor(docs, accountId));
  const counts = {};
  docs.forEach(d => { counts[d.coll] = (counts[d.coll] || 0) + 1; });
  console.log('documents written:', docs.length, counts);
}

if (require.main === module) main();
module.exports = { build, sqlFor, chunkOf, recKey, sid };
