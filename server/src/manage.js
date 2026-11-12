'use strict';
// Manage log-in accounts from the command line (there is no self sign-up).
//   npm run user -- add <email> "<name>" <password>
//   npm run user -- password <email> <new-password>
//   npm run user -- disable <email>  |  enable <email>
//   npm run user -- list
//   npm run user -- link <email> <in-app user id>   (sets which in-app user this log-in is)
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { createPool, applySchema } = require('./db');

const [command, ...args] = process.argv.slice(2);
const pool = createPool();

function usage() {
  console.log(`Usage:
  npm run user -- add <email> "<name>" <password>
  npm run user -- password <email> <new-password>
  npm run user -- disable <email>
  npm run user -- enable <email>
  npm run user -- list
  npm run user -- link <email> <in-app user id>`);
}
function need(list, n) { if (list.length < n) { usage(); throw new Error('Missing arguments'); } }

async function setActive(email, active) {
  const r = await pool.query('UPDATE accounts SET active = $1 WHERE email = $2', [active, email.toLowerCase()]);
  if (!r.rowCount) throw new Error('No account with email ' + email);
  console.log(`${email} is now ${active ? 'enabled' : 'disabled'}.`);
}

async function main() {
  await applySchema(pool);
  if (command === 'add') {
    need(args, 3);
    const [email, name, password] = args;
    if (password.length < 8) throw new Error('Use at least 8 characters for the password.');
    const hash = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO accounts (id, email, name, password_hash) VALUES ($1, $2, $3, $4)',
      [crypto.randomUUID(), email.trim().toLowerCase(), name, hash]);
    console.log(`Created log-in for ${email}.`);
  } else if (command === 'password') {
    need(args, 2);
    const [email, password] = args;
    if (password.length < 8) throw new Error('Use at least 8 characters for the password.');
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query('UPDATE accounts SET password_hash = $1 WHERE email = $2', [hash, email.toLowerCase()]);
    if (!r.rowCount) throw new Error('No account with email ' + email);
    await pool.query('DELETE FROM sessions WHERE account_id = (SELECT id FROM accounts WHERE email = $1)', [email.toLowerCase()]);
    console.log(`Password changed for ${email}. The person is logged out everywhere.`);
  } else if (command === 'disable') {
    need(args, 1); await setActive(args[0], false);
  } else if (command === 'enable') {
    need(args, 1); await setActive(args[0], true);
  } else if (command === 'list') {
    const { rows } = await pool.query('SELECT email, name, active, last_login FROM accounts ORDER BY email');
    console.table(rows.map(r => ({ email: r.email, name: r.name, active: r.active ? 'yes' : 'no', last_login: r.last_login ? r.last_login.toISOString() : '' })));
  } else if (command === 'link') {
    // Points an in-app user (Admin > Users) at this log-in. Needed after the master file is loaded,
    // because that file carries the account IDs of the database it came from.
    need(args, 2);
    const [email, userId] = args;
    const acc = await pool.query('SELECT id FROM accounts WHERE email = $1', [email.toLowerCase()]);
    if (!acc.rows.length) throw new Error('No log-in with email ' + email);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query("SELECT data FROM kv_docs WHERE coll = 'm_users' AND id = 'all' FOR UPDATE");
      if (!rows.length) throw new Error('The user list (m_users/all) is not in this database. Load the master file first.');
      const doc = rows[0].data;
      const users = doc.rows || {};
      if (!users[userId] || !users[userId].r) throw new Error('No in-app user with ID ' + userId);
      const accountId = acc.rows[0].id;
      for (const x of Object.values(users)) if (x && x.r && x.r.cid === accountId) x.r.cid = '';
      users[userId].r.cid = accountId;
      await client.query("UPDATE kv_docs SET data = $1::jsonb, updated_by = 'manage-link', updated_at = now() WHERE coll = 'm_users' AND id = 'all'", [JSON.stringify(doc)]);
      await client.query('COMMIT');
      console.log('Linked ' + email + ' to in-app user ' + userId + '.');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
  } else {
    usage();
  }
}

main()
  .catch(e => { console.error('Error:', e.message); process.exitCode = 1; })
  .finally(() => pool.end());
