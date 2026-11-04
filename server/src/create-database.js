'use strict';
// Creates the app's database user and database on the local PostgreSQL.
// Run by setup/3-create-database.ps1. Passwords come from environment variables, not the command line.
// Safe to run again: an existing user gets the new password, an existing database is left as it is.
const { Client } = require('pg');

const PORT = Number(process.env.PG_PORT || 5433);
const SUPER_PW = process.env.PG_SUPERUSER_PASSWORD;
const APP_PW = process.env.KUNMH_PASSWORD;
const DB = process.env.DB_NAME || 'kun_mh';
const USER = process.env.DB_USER || 'kunmh';

if (!SUPER_PW || !APP_PW) {
  console.error('The superuser and app passwords must be given in PG_SUPERUSER_PASSWORD and KUNMH_PASSWORD.');
  process.exit(2);
}

(async () => {
  const admin = new Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: SUPER_PW, database: 'postgres' });
  await admin.connect();
  try {
    // format() quotes names and passwords safely, so no SQL is built by hand from the input
    const userExists = (await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [USER])).rowCount > 0;
    const sql = userExists
      ? (await admin.query('SELECT format(\'ALTER USER %I WITH PASSWORD %L\', $1::text, $2::text) AS q', [USER, APP_PW])).rows[0].q
      : (await admin.query('SELECT format(\'CREATE USER %I WITH PASSWORD %L\', $1::text, $2::text) AS q', [USER, APP_PW])).rows[0].q;
    await admin.query(sql);
    console.log(userExists ? `User ${USER}: password updated.` : `User ${USER}: created.`);

    const dbExists = (await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB])).rowCount > 0;
    if (dbExists) {
      console.log(`Database ${DB}: already exists.`);
    } else {
      const q = (await admin.query('SELECT format(\'CREATE DATABASE %I OWNER %I\', $1::text, $2::text) AS q', [DB, USER])).rows[0].q;
      await admin.query(q);
      console.log(`Database ${DB}: created.`);
    }
  } finally {
    await admin.end();
  }

  // the app user needs rights on the public schema of its own database
  const inDb = new Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: SUPER_PW, database: DB });
  await inDb.connect();
  try {
    await inDb.query('GRANT ALL ON SCHEMA public TO ' + (await inDb.query('SELECT quote_ident($1::text) AS u', [USER])).rows[0].u);
    console.log(`Rights on ${DB} granted to ${USER}.`);
  } finally {
    await inDb.end();
  }
})().catch(e => {
  console.error('Database setup failed:', e.message);
  process.exit(1);
});
