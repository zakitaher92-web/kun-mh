'use strict';
// Creates the KUN MH login role and database on the shared PostgreSQL 18 cluster (step 3 of the set-up).
// Run by setup/3-create-database.ps1. Passwords come from environment variables, never the command line.
//
// Safe to run again:
// - the role gets the password given now (created or updated), and is never dropped;
// - the database is created only if missing, and its settings are set again each time.
//
// It never edits postgresql.conf or pg_hba.conf, never touches other databases, and never drops anything.
// If pg_hba.conf has no rule for the app, it prints the line to add. Nothing is applied.
const { Client } = require('pg');

const PORT = Number(process.env.PG_PORT || 5432);
const SUPER_PW = process.env.PG_SUPERUSER_PASSWORD;
const APP_PW = process.env.KUNMH_PASSWORD;
const DB = process.env.DB_NAME || 'kun_mh';
const USER = process.env.DB_USER || 'kunmh';
const TZ = process.env.TZ || 'Asia/Baghdad';
const EXTENSIONS = [];   // none needed: gen_random_uuid() is built into PostgreSQL 13 and later

const PRIVILEGE_MSG = 'The postgres user is not allowed to do this (insufficient privilege). '
  + 'Check the postgres password, and that it is the superuser of this PostgreSQL cluster.';

class SetupError extends Error {
  constructor(message, code) { super(message); this.exitCode = code; }
}

async function run(client, sql, params) {
  return client.query(sql, params);
}

(async () => {
  if (!SUPER_PW || !APP_PW) {
    throw new SetupError('The postgres and kunmh passwords must be given in PG_SUPERUSER_PASSWORD and KUNMH_PASSWORD.', 2);
  }

  const admin = new Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: SUPER_PW, database: 'postgres' });
  await admin.connect();
  try {
    // 1. The server must be PostgreSQL 18 or newer.
    const verNum = Number((await run(admin, 'SHOW server_version_num')).rows[0].server_version_num);
    if (verNum < 180000) {
      throw new SetupError(`The server on port ${PORT} is PostgreSQL ${Math.floor(verNum / 10000)}. PostgreSQL 18 is required.`, 3);
    }
    console.log(`Server: PostgreSQL ${Math.floor(verNum / 10000)}.${verNum % 10000} on port ${PORT}.`);

    // 2. The login role (created, or given the password now).
    const roleExists = (await run(admin, 'SELECT 1 FROM pg_roles WHERE rolname = $1', [USER])).rowCount > 0;
    const roleSql = (await run(admin, roleExists
      ? "SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', $1::text, $2::text) AS q"
      : "SELECT format('CREATE ROLE %I WITH LOGIN PASSWORD %L', $1::text, $2::text) AS q", [USER, APP_PW])).rows[0].q;
    await run(admin, roleSql);
    console.log(roleExists ? `Role ${USER}: password updated.` : `Role ${USER}: created.`);

    // 3. The database: owned by the app role, UTF-8, from template0, created only if missing.
    const dbExists = (await run(admin, 'SELECT 1 FROM pg_database WHERE datname = $1', [DB])).rowCount > 0;
    if (dbExists) {
      console.log(`Database ${DB}: already exists (left as it is).`);
    } else {
      const dbSql = (await run(admin, "SELECT format('CREATE DATABASE %I OWNER %I ENCODING %L TEMPLATE template0', $1::text, $2::text, 'UTF8') AS q",
        [DB, USER])).rows[0].q;
      await run(admin, dbSql);
      console.log(`Database ${DB}: created (owner ${USER}, UTF8, template0).`);
    }

    // 4. Only the app role may connect; the time zone of the database is set for business dates.
    await run(admin, (await run(admin, "SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', $1::text) AS q", [DB])).rows[0].q);
    await run(admin, (await run(admin, "SELECT format('ALTER DATABASE %I SET timezone = %L', $1::text, $2::text) AS q", [DB, TZ])).rows[0].q);
    console.log(`Access: ${DB} is closed to PUBLIC; time zone ${TZ}.`);

    // 5. pg_hba.conf: report only. A matching rule is needed for the app to log in over TCP on 127.0.0.1.
    let hbaOk = null;
    try {
      // address holds the IP only (127.0.0.1 or ::1); the netmask is a separate column
      const rules = await run(admin, `SELECT type, database, user_name, address, auth_method, error
        FROM pg_hba_file_rules WHERE error IS NULL`);
      hbaOk = rules.rows.some(r =>
        ['host', 'hostssl', 'hostnossl'].includes(r.type) &&
        (r.database || []).some(d => d === DB || d === 'all') &&
        (r.user_name || []).some(u => u === USER || u === 'all') &&
        (r.address === '127.0.0.1' || r.address === '::1'));
    } catch (e) {
      console.log('pg_hba.conf: could not be read from the database (' + e.message + '). Check the line below by hand.');
    }
    if (hbaOk === true) {
      console.log('pg_hba.conf: a rule for this role on 127.0.0.1 already exists. Nothing to change.');
    } else if (hbaOk === false) {
      console.log('pg_hba.conf: NO rule found for this role on 127.0.0.1. Add this line to pg_hba.conf of the cluster,');
      console.log('above any reject rule, and reload the service. This script does not edit the file:');
      console.log(`    host    ${DB}    ${USER}    127.0.0.1/32    scram-sha-256`);
    }
  } finally {
    await admin.end();
  }

  // 6. Inside the app database: the schema rights and the extensions the app needs (none at present).
  const inDb = new Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: SUPER_PW, database: DB });
  await inDb.connect();
  try {
    await run(inDb, (await run(inDb, "SELECT format('GRANT ALL ON SCHEMA public TO %I', $1::text) AS q", [USER])).rows[0].q);
    for (const ext of EXTENSIONS) {
      await run(inDb, (await run(inDb, "SELECT format('CREATE EXTENSION IF NOT EXISTS %I', $1::text) AS q", [ext])).rows[0].q);
    }
    console.log(`Rights on ${DB}: granted to ${USER}.${EXTENSIONS.length ? ' Extensions: ' + EXTENSIONS.join(', ') + '.' : ' No extensions are needed.'}`);
  } finally {
    await inDb.end();
  }
})().catch(e => {
  if (e.exitCode) {
    console.error(e.message);
    process.exit(e.exitCode);
  }
  if (e.code === '42501') console.error(PRIVILEGE_MSG);
  else console.error('Database setup failed:', e.message);
  process.exit(1);
});
