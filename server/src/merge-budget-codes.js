'use strict';
// Version 1.9 budget codes: merges MT-01..MT-05 and HK-01, HK-02 into one budget line MT; adds budget line SR
// (every category of type "Service / labour" moves to SR); renames the HK item codes HK-nnn to ITM-nnn (same number).
// Every saved reference to a changed code is changed too (POs, bills, GRNs, issues, MPL rows, items, categories).
// Usage (in the server folder, with the app stopped):
//   npm run budget:merge -- --dry-run
//   npm run budget:merge -- --apply --backup ..\..\dist\budget-merge-backup.json
const fs = require('fs');
const path = require('path');
const { createPool } = require('./db');

const OLD_BUDGET = ['MT-01', 'MT-02', 'MT-03', 'MT-04', 'MT-05', 'HK-01', 'HK-02'];
const ITEM_RE = /^HK-(\d{3})$/;

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const bi = args.indexOf('--backup');
  const backupFile = bi >= 0 ? args[bi + 1] : null;
  if (apply && !backupFile) { console.error('--apply needs --backup <file>.'); process.exit(1); }

  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bl = await client.query("SELECT data FROM kv_docs WHERE coll = 'cfg' AND id = 'budgetLines' FOR UPDATE");
    const cat = await client.query("SELECT data FROM kv_docs WHERE coll = 'cfg' AND id = 'categories' FOR UPDATE");
    if (!bl.rows.length || !cat.rows.length) throw new Error('Budget lines or categories not found.');
    const lines = bl.rows[0].data.v || [];
    const mt = lines.filter(l => OLD_BUDGET.includes(l.code));
    if (!mt.length) throw new Error('The old budget lines were not found: nothing to merge (already done?).');
    const annual = mt.reduce((a, l) => a + Number(l.annual || 0), 0);
    const newLines = [
      { code: 'MT', name: 'Maintenance and housekeeping (merged)', basis: 'FIX', annual },
      { code: 'SR', name: 'Service receipts - service and labour bills (SRN)', basis: 'FIX', annual: 0 },
    ];
    const cats = cat.rows[0].data.v || [];
    let toSR = 0, toMT = 0;
    const newCats = cats.map(c => {
      if (c.type === 'Service / labour') { toSR++; return { ...c, line: 'SR' }; }
      if (OLD_BUDGET.includes(c.line)) { toMT++; return { ...c, line: 'MT' }; }
      return c;
    });
    const items = await client.query("SELECT data FROM kv_docs WHERE coll = 'm_items' AND id = 'all' FOR UPDATE");
    const itemDoc = items.rows[0] ? items.rows[0].data : {};
    const codes = [...new Set(JSON.stringify(itemDoc).match(/"HK-\d{3}"/g) || [])].map(q => JSON.parse(q));
    const itemMap = codes.filter(c => ITEM_RE.test(c)).map(c => ({ from: c, to: 'ITM-' + c.slice(3) }));
    const clash = itemMap.filter(m => JSON.stringify(itemDoc).includes(`"${m.to}"`));
    if (clash.length) throw new Error('New item codes already exist: ' + clash.map(c => c.to).join(', '));

    console.log(`${apply ? 'APPLYING' : 'DRY RUN'}`);
    console.log(`  budget lines: ${mt.map(l => l.code).join(', ')} -> MT (annual ${annual}); new line SR`);
    console.log(`  categories: ${toSR} service/labour -> SR; ${toMT} others -> MT`);
    console.log(`  item codes: ${itemMap.length} HK-nnn -> ITM-nnn (e.g. ${itemMap[0] ? itemMap[0].from + ' -> ' + itemMap[0].to : '-'})`);
    console.log(`  budget codes replaced in all documents: ${OLD_BUDGET.join(', ')} -> MT`);

    if (!apply) { await client.query('ROLLBACK'); console.log('Dry run finished. Nothing saved.'); return; }

    const changed = [];
    const snapshot = async (oldQ) => {
      const hits = await client.query('SELECT coll, id, data FROM kv_docs WHERE strpos(data::text, $1) > 0', [oldQ]);
      hits.rows.forEach(h => { if (!changed.find(c => c.coll === h.coll && c.id === h.id)) changed.push({ coll: h.coll, id: h.id, data: h.data }); });
    };
    changed.push({ coll: 'cfg', id: 'budgetLines', data: bl.rows[0].data }, { coll: 'cfg', id: 'categories', data: cat.rows[0].data });
    await client.query("UPDATE kv_docs SET data = $1::jsonb, updated_by = 'budget-merge-1.9' WHERE coll = 'cfg' AND id = 'budgetLines'", [JSON.stringify({ v: newLines })]);
    await client.query("UPDATE kv_docs SET data = $1::jsonb, updated_by = 'budget-merge-1.9' WHERE coll = 'cfg' AND id = 'categories'", [JSON.stringify({ v: newCats })]);
    for (const code of OLD_BUDGET) {
      const q = JSON.stringify(code), nq = JSON.stringify('MT');
      await snapshot(q);
      await client.query("UPDATE kv_docs SET data = replace(data::text, $1, $2)::jsonb, updated_by = 'budget-merge-1.9', updated_at = now() WHERE strpos(data::text, $1) > 0", [q, nq]);
    }
    for (const m of itemMap) {
      const q = JSON.stringify(m.from), nq = JSON.stringify(m.to);
      await snapshot(q);
      await client.query("UPDATE kv_docs SET data = replace(data::text, $1, $2)::jsonb, updated_by = 'budget-merge-1.9', updated_at = now() WHERE strpos(data::text, $1) > 0", [q, nq]);
    }
    fs.writeFileSync(backupFile, JSON.stringify({ savedAt: new Date().toISOString(), docs: changed }, null, 2), 'utf8');
    const left = await client.query(`SELECT count(*) n FROM kv_docs WHERE ${OLD_BUDGET.map(c => `strpos(data::text, '"${c}"') > 0`).join(' OR ')}`);
    if (Number(left.rows[0].n) > 0) throw new Error('Some old budget codes are still in use: ' + left.rows[0].n + ' documents');
    await client.query('COMMIT');
    console.log(`Done. Documents changed: ${changed.length}. Backup: ${path.resolve(backupFile)}`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error('Budget merge failed, nothing was saved:', e.message); process.exit(1); });
