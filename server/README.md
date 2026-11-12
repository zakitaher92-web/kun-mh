# KUN MH - server (technical reference)

The Node.js server runs the app and keeps all records in PostgreSQL 16. It is used in two places:

- **Office server (Windows):** the app runs behind IIS on port 3100, with its own database cluster on port 5433. For a normal installation use the scripts in the `setup` folder and [INSTALLATION_GUIDE.md](../INSTALLATION_GUIDE.md). This page explains what the scripts do, and how to run the same steps by hand.
- **Hosted (Vercel + Neon):** `api/index.js` (the folder above) runs the same Express app as a serverless function, with `DATABASE_URL` pointing at Neon. See INSTALLATION_GUIDE.md, Part 10.

```
office browser  ->  http://SERVER:8080 (IIS)  ->  http://127.0.0.1:3100 (Node.js, Express)  ->  PostgreSQL (database kun_mh, port 5433)
```

Ports used by other applications on the office server and never used by KUN MH: 3000 (Billing app), 80 and 443 (Billing IIS site), 5432 (Billing PostgreSQL).

## What the setup scripts do

| Script | Equivalent manual step |
|---|---|
| `setup\1-check-requirements.bat` | Checks Node.js 22.9+, the PostgreSQL programs, IIS URL Rewrite and ARR, and that ports 3100, 8080, 8443 and 5433 are free |
| `setup\2-install-packages.bat` | `npm install` in this folder |
| `setup\3-create-database.bat` | Creates the KUN MH cluster (service `postgresql-kun-16`, port 5433, data in `C:\KUN\pgdata-kun`) if it does not exist, then runs `src\create-database.js`: creates user `kunmh` and database `kun_mh` (safe to re-run) |
| `setup\4-configure.bat` | Writes `.env` and runs `npm run user -- list`, which connects and creates the tables |
| `setup\5-create-admin.bat` | `npm run user -- add EMAIL "NAME" "PASSWORD"` |
| `setup\6-start-app.bat` | Registers the scheduled task `KUN-MH Server`, which runs `setup\run-server.cmd` (`npm start`, output to `logs\server.log`) at startup and restarts it if it stops |
| `setup\stop-app.bat` | Ends the scheduled task and the server process |
| `setup\7-setup-iis.bat` | Installs IIS, writes `iis\web.config` (proxy to `http://127.0.0.1:3100`), creates the `KUN-MH` application pool and site, sets the office ports, opens the firewall for those ports only |
| `setup\check-access.bat` | Read-only check of services, ports, IIS bindings, firewall rules and network reachability |
| `setup\8-backup.bat` | `pg_dump` into `C:\KUN\backups` |

Passwords are typed in hidden. Steps 3 and 4 can also read them from the environment variables `KUN_PG_SUPERUSER_PASSWORD` and `KUNMH_PASSWORD`. Ports can be set with `KUN_APP_PORT`, `KUN_PG_PORT`, `KUN_HTTP_PORT` and `KUN_HTTPS_PORT`.

## Settings (`server\.env`)

Copy `.env.example` to `.env` and fill in the values. The file is git-ignored. Names and meanings:

| Setting | Meaning | Default |
|---|---|---|
| `PORT`, `HOST` | Port and address the app listens on. Keep `HOST=127.0.0.1` | 3100, 127.0.0.1 |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | The database connection (office server) | 127.0.0.1, 5433, kun_mh, kunmh |
| `DATABASE_URL` | Full connection string. Takes precedence over the `DB_*` values (Vercel and Neon) | none |
| `DB_SSL` | `require` turns on TLS (Neon needs it) | off |
| `DB_POOL_MAX` | Connections per server process | 10 |
| `DATA_MODE` | `kv` (documents in `kv_docs`) or `tables` (relational tables). See below | kv |
| `COOKIE_SECURE` | `true` marks the session cookie `Secure` (HTTPS only) | off |
| `LIVE_UPDATES` | `off` switches off the database listener for live updates | on |

Never put a real password or connection string in this README, in the repository, or in a shared file.

## Data modes

The server keeps the documents in one of two layouts, chosen by `DATA_MODE`:

| Mode | Layout | Notes |
|---|---|---|
| `kv` | `kv_docs` (one row per document, JSON) | The office server runs in this mode. The original layout |
| `tables` | The relational tables in `schema-tables.sql` (registers, lines, `settings`, `number_counters`, `doc_numbers`, `audit_log`, `notifications`, `users`, ...). Each record is also kept as JSON in its `record` column | Hosted (Vercel + Neon) after the cutover |

Both modes return the same documents to the browser. Moving between them uses two commands, both **dry-run by default**: they build the new layout, run every check, and roll back unless `--apply` is given.

```bat
npm run migrate:tables                                     rem kv_docs -> tables: dry run
npm run migrate:tables -- --apply --confirm-target HOST/DB  rem kv_docs -> tables: commit
npm run migrate:kv                                          rem tables -> kv_docs: dry run
npm run migrate:kv -- --apply --confirm-target HOST/DB      rem tables -> kv_docs: commit
```

- `--confirm-target` must match the target name that the dry run prints (`HOST/DB`). This stops a run against the wrong database.
- `migrate:tables` empties the tables and loads them again from `kv_docs`. `kv_docs` is only read.
- `migrate:kv` writes `kv_docs` in full. Before it replaces the rows it copies them to a backup table named `kv_docs_backup_<time>`, and records that name in `migration_runs`.
- Both commands record each applied run in `migration_runs`, and accept `--report <file>` to keep the full report.
- Locks: `migrate:kv` takes shared locks on the tables for the length of the run, so a save cannot land in them and be missed. Stop writes anyway while a cutover is running (INSTALLATION_GUIDE.md, Part 10).

To check the two modes against each other: `node testing/parity-tables.js` (with the database URL set) compares every collection, and rolls back its own test write.

## Account commands

```bat
npm run user -- add EMAIL "Full Name" "password-of-8-or-more"
npm run user -- list
npm run user -- password EMAIL "new-password"     rem also logs the person out everywhere
npm run user -- disable EMAIL
npm run user -- enable EMAIL
```

## Other commands

| Command | What it does |
|---|---|
| `npm test` | Runs the 68 automatic tests (no database needed) |
| `npm start` | Starts the server (`src\server.js`) |
| `npm run db:status` | Shows the tables and record counts of the database named in the settings (no secrets printed) |
| `npm run masters:export`, `npm run masters:import -- FILE [--dry-run]` | Exports and imports the master data (items, vendors, users, price list, budget, categories, settings) |
| `npm run vendors:english`, `npm run budget:merge`, `npm run roles:fix-1.9`, `npm run vendors:avl` | One-time data corrections used by the 1.9 upgrade (guide, Parts 7 and 8). Keep for installations that still need them |

## Database user and database, by hand

Created by hand (for example in psql as the `postgres` user of the KUN MH cluster, port 5433):

```sql
CREATE USER kunmh WITH PASSWORD 'your-kunmh-password';
CREATE DATABASE kun_mh OWNER kunmh;
\c kun_mh
GRANT ALL ON SCHEMA public TO kunmh;
```

## Looking at the data

Any of these tools works (all connect to `127.0.0.1`, port `5433`, database `kun_mh`, user `kunmh`):

- **pgAdmin 4**, installed with PostgreSQL.
- **psql**, from the PostgreSQL *Command Line Tools*:
  ```bat
  "C:\Program Files\PostgreSQL\16\bin\psql.exe" -h 127.0.0.1 -p 5433 -U kunmh -d kun_mh
  ```
  Useful queries:
  ```sql
  SELECT coll, count(*) FROM kv_docs GROUP BY coll ORDER BY coll;      -- kv mode
  SELECT count(*) FROM pos;                                            -- tables mode
  SELECT email, name, active FROM accounts;
  SELECT jsonb_pretty(data) FROM kv_docs WHERE coll = 'cfg' AND id = 'settings';
  ```

Editing rows directly changes what the app sees. Back up first. Never connect to the Billing database (port 5432) with these settings.

## Reset for a clean test

Stop the app first (`setup\stop-app.bat`). Then, as the `postgres` user of the KUN MH cluster (port 5433):

```sql
DROP DATABASE IF EXISTS kun_mh WITH (FORCE);
DROP ROLE IF EXISTS kunmh;
```

Delete `server\.env` and run the setup scripts again from step 3.

## Backups

`setup\8-backup.bat` writes `kun_mh_YYYY-MM-DD_HHMM.sql` into `C:\KUN\backups`. The same thing by hand:

```bat
"C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" -h 127.0.0.1 -p 5433 -U kunmh -d kun_mh -f kun_mh_backup.sql
```

Restore into an empty `kun_mh` database:

```bat
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -h 127.0.0.1 -p 5433 -U kunmh -d kun_mh -f kun_mh_backup.sql
```

Take a backup before any migration. `migrate:tables` does not change `kv_docs`. `migrate:kv` keeps a copy of `kv_docs` in a backup table (`kv_docs_backup_*`), as described above, but that is not a substitute for a full backup.

## Alternative: portable PostgreSQL (no installer)

Use this only when the official installer cannot be used. This is an unofficial PostgreSQL 16.15 build packaged for npm; it was tested for this app. It does not replace the cluster that step 3 creates, and it must not use port 5432.

1. In a folder such as `C:\pgsql`, run `npm install @embedded-postgres/windows-x64@16.15.0-beta.19`.
2. Set `PGBIN` to `...\node_modules\@embedded-postgres\windows-x64\native\bin` in that folder.
3. Create the data folder with `initdb.exe -D C:\pgdata -U postgres --pwfile=...` (write the superuser password to a temporary file and delete it afterwards; run it as a user that is not an administrator), then start it with `pg_ctl.exe -D C:\pgdata -l C:\pgsql\server.log -o "-p 5433" start`.
4. Stop it with `pg_ctl.exe -D C:\pgdata stop`.

The portable build has no `psql` and no `pg_dump`, so use the app's own backup, or install the PostgreSQL 16 Command Line Tools.

## Files

| File | What it does |
|---|---|
| `src\server.js` | Office server start-up: the HTTP listener and live updates (database LISTEN/NOTIFY) |
| `src\app.js` | The Express app: log-in, document API with role checks, number leases, live-update stream, serves `index.html` |
| `src\store.js` | Storage behind the document API: `kv` (kv_docs) or `tables` (relational), chosen by `DATA_MODE` |
| `src\registers.js` | Shared register definitions: which collection goes to which table, and the typed columns |
| `src\permissions.js` | Access rules: who may read and write each collection, from the Admin access-rights table |
| `src\db.js` | Connection settings and pool; applies `schema.sql` at start-up |
| `src\manage.js` | Account commands (`npm run user`) |
| `src\create-database.js` | Creates the app user and database (used by setup step 3) |
| `src\db-status.js` | Connection and table counts (`npm run db:status`) |
| `src\migrate-to-tables.js` | Copies `kv_docs` into the relational tables (`npm run migrate:tables`) |
| `src\migrate-tables-to-kv.js` | Copies the tables back into `kv_docs` (`npm run migrate:kv`), the rollback path |
| `src\export-masters.js`, `src\import-masters.js` | Master-data export and import |
| `src\approve-vendors.js`, `src\rename-vendors.js`, `src\merge-budget-codes.js`, `src\fix-roles-1.9.js` | One-time data corrections for the 1.9 upgrade. `fix-roles-1.9.js` and `approve-vendors.js` are used by the tests |
| `src\convert-v22.js` | Converts an older data file (version 2.2 workbook) into the database. Used by the local test server |
| `client\server-adapter.js` | Browser side: sends the app's data requests to this server |
| `schema.sql` | Tables used by every mode: `accounts`, `sessions`, `kv_docs` |
| `schema-tables.sql` | Tables for tables mode, including `migration_runs` (applied by `migrate:tables`) |
| `upgrade-1.9.sql` | One-time data upgrade for installations made before 1.9 (guide, Part 7) |
| `vendor-names-en.json` | The English vendor names used by `vendors:english` |
| `test\` | The automatic tests (`npm test`) |
| `testing\` | A local test server (`dev-server.js`), a fake database pool for the tests (`fake-pool.js`), and the parity check (`parity-tables.js`). Not for the live system |
| `.env.example` | Settings template for `.env` |

## Security notes

- The app listens on `127.0.0.1` (this server only). Keep it that way: on the office server, IIS sits in front (`setup\7-setup-iis.bat`), which applies the network restriction and HTTPS. `HOST=0.0.0.0` would expose the app without IIS and is not supported.
- The KUN MH database listens on `localhost` only (port 5433). `setup\check-access.bat` confirms that it does not answer from the network.
- Access to documents is checked by the server against each role's rights. Routes that need only a signed-in user are open to every signed-in person (see the README, Security notes).
- `.env` contains database credentials. It is listed in `.gitignore`; do not copy it elsewhere.
