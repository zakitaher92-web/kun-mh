'use strict';
// Shared by the copy script (migrate-to-tables.js) and the server's tables mode (store.js):
// how each kv_docs register maps to its table and typed columns.

// ---------- helpers (the key rule is the same as the browser's sid()) ----------
const sid = s => String(s || 'x').replace(/[^A-Za-z0-9_\-.~:@+]/g, '-');
const nz = v => (v === null || v === undefined || String(v).trim() === '') ? null : String(v).trim();
const num = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const dateOf = (v, warnings, where) => {
  const s = nz(v);
  if (!s) return null;
  const m = /^\d{4}-\d{2}-\d{2}/.exec(s);
  if (m) return m[0];
  warnings.push(`${where}: date "${s}" is not yyyy-mm-dd, stored as empty`);
  return null;
};
// Legacy records hold the text "NO PO" in po; a real PO number contains /PO/.
const realPo = po => { const s = nz(po); return s && /\/PO\//.test(s) ? s : null; };
const lineAmount = l => num(l.amount) ?? Math.round((num(l.qty) || 0) * (num(l.rate) || 0));
const canon = v => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') return Object.keys(v).sort().reduce((o, k) => { o[k] = canon(v[k]); return o; }, {});
  return v;
};
const canonStr = v => JSON.stringify(canon(v));
const sumOf = (list, f) => list.reduce((a, x) => a + (f(x) || 0), 0);

// ---------- what each register becomes ----------
// cols(record, warnings) -> typed columns. lines: child table rows of the record.
const REGISTERS = [
  { coll: 'm_pos', table: 'pos', key: 'no',
    cols: (r, w) => ({ po_date: dateOf(r.date, w, `pos ${r.no}`), vendor: nz(r.vendor), budget_line: nz(r.line), approved_by: nz(r.approvedBy), cancelled: !!r.cancel }),
    lines: { table: 'po_lines', parent: 'po_no', from: r => r.lines,
      cols: l => ({ item_code: nz(l.item), qty: num(l.qty), rate: num(l.rate) }) } },
  { coll: 'm_advances', table: 'advances', key: 'no',
    cols: (r, w) => ({ adv_date: dateOf(r.date, w, `advances ${r.no}`), po_no: realPo(r.po) }) },
  { coll: 'm_grns', table: 'grns', key: 'no',
    cols: (r, w) => ({ grn_date: dateOf(r.date, w, `grns ${r.no}`), po_no: realPo(r.po), no_po: !realPo(r.po), vendor: nz(r.vendor), challan: nz(r.challan), received_by: nz(r.by) }),
    lines: { table: 'grn_lines', parent: 'grn_no', from: r => r.lines,
      cols: l => ({ item_code: nz(l.item), received: num(l.recd), accepted: num(l.acc) }) } },
  { coll: 'm_srns', table: 'srns', key: 'no',
    cols: (r, w) => ({ srn_date: dateOf(r.date, w, `srns ${r.no}`), po_no: realPo(r.po) }),
    lines: { table: 'srn_lines', parent: 'srn_no', from: r => r.lines,
      cols: l => ({ item_code: nz(l.item), qty: num(l.qty) }) } },
  { coll: 'm_bills', table: 'bills', key: 'no',
    cols: (r, w) => ({ bill_date: dateOf(r.date, w, `bills ${r.no}`), po_no: realPo(r.po), vendor: nz(r.vendor), inv_no: nz(r.invNo), amount: num(r.amount) }),
    // the app writes items; older records hold the same lines under lines
    lines: { table: 'bill_items', parent: 'bill_no', from: r => (Array.isArray(r.items) && r.items.length ? r.items : (r.lines || [])),
      cols: l => ({ item_code: nz(l.item), qty: num(l.qty), rate: num(l.rate), amount: lineAmount(l) }) } },
  { coll: 'm_cpvs', table: 'cpvs', key: 'no',
    cols: (r, w) => ({ cpv_date: dateOf(r.date, w, `cpvs ${r.no}`) }) },
  { coll: 'm_issues', table: 'issues', key: 'no',
    cols: (r, w) => ({ issue_date: dateOf(r.date, w, `issues ${r.no}`), job_no: nz(r.job) }),
    // legacy issue lines are [item, qty]; current ones are {item, qty}
    lines: { table: 'issue_lines', parent: 'issue_no', from: r => r.lines || [],
      cols: l => Array.isArray(l) ? { item_code: nz(l[0]), qty: num(l[1]) } : { item_code: nz(l.item), qty: num(l.qty) } } },
  { coll: 'm_jobs', table: 'jobs', key: 'no',
    cols: (r, w) => ({ job_date: dateOf(r.date, w, `jobs ${r.no}`) }) },
  { coll: 'm_laundry', table: 'laundry', key: 'id',
    cols: (r, w) => ({ laundry_date: dateOf(r.date, w, `laundry ${r.id}`) }) },
  { coll: 'm_ppm', table: 'ppm_equipment', key: 'id', cols: () => ({}) },
  { coll: 'm_rooms', table: 'rooms', key: 'no', cols: () => ({}) },
  { coll: 'm_items', table: 'items', key: 'code',
    cols: r => ({ name: nz(r.name), category: nz(r.cat), unit: nz(r.unit), mpl_rate: num(r.mpl) }) },
  { coll: 'm_vendors', table: 'vendors', key: 'code',
    cols: r => ({ name: nz(r.name), avl: r.avl === 'Y' }) },
  { coll: 'm_users', table: 'users', key: 'id',
    cols: r => ({ name: nz(r.name), role: nz(r.role), cid: nz(r.cid), active: r.active !== 'N' }) },
  { coll: 'm_notifs', table: 'notifications', key: 'id', cols: () => ({}) },
  { coll: 'm_audit', table: 'audit_log', key: 'k',
    cols: r => ({ event_at: nz(r.t), username: nz(r.user), action: nz(r.action) }) },
];

// Tables in load order (parents before children). TRUNCATE uses the same list.
const TABLES = [
  'settings', 'number_counters', 'budget_lines', 'categories',
  'pos', 'po_lines', 'advances', 'grns', 'grn_lines', 'srns', 'srn_lines',
  'bills', 'bill_items', 'cpvs', 'issues', 'issue_lines', 'jobs', 'laundry',
  'ppm_equipment', 'rooms', 'items', 'vendors', 'users', 'doc_numbers', 'audit_log', 'notifications',
];


module.exports = { sid, nz, num, dateOf, realPo, lineAmount, canon, canonStr, sumOf, REGISTERS, TABLES };
