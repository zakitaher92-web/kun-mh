# KUN MH - local server (technical reference)

The server runs the app on this computer and keeps all records in PostgreSQL 16. For a normal installation use the scripts in the `setup` folder and [INSTALLATION_GUIDE.md](../INSTALLATION_GUIDE.md). This page explains what the scripts do underneath, and how to run the same steps by hand.

```
browser  ->  http://localhost:3000  ->  Node.js (Express)  ->  PostgreSQL (database kun_mh, port 5432)
```

## What the setup scripts do

| Script | Equivalent manual step |
|---|---|
| `setup\1-check-requirements.bat` | Checks Node.js 22+, PostgreSQL on port 5432, and that port 3000 is free |
| `setup\2-install-packages.bat` | `npm install` in this folder |
| `setup\3-create-database.bat` | Runs `src\create-database.js`: creates user `kunmh` and database `kun_mh` (safe to re-run) |
| `setup\4-configure.bat` | Writes `.env` and runs `npm run user -- list`, which connects and creates the tables |
| `setup\5-create-admin.bat` | `npm run user -- add EMAIL "NAME" "PASSWORD"` |
| `setup\6-start-app.bat` | `npm start` in a new window, then opens the browser |
| `setup\7-backup.bat` | `pg_dump` into `C:\KUN\backups` |

Passwords are typed in hidden. Step 3 and step 4 can also read them from the environment variables `KUN_PG_SUPERUSER_PASSWORD` and `KUNMH_PASSWORD`, which is how the scripts were tested without typing.

## Manual commands

Run these in the `server` folder.

```bat
npm install
copy .env.example .env          rem then edit .env: DB_PASSWORD must match the kunmh password
npm start                       rem the server; open http://localhost:3000
```

`.env` settings:

```
PORT=3000
HOST=127.0.0.1

DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=kun_mh
DB_USER=kunmh
DB_PASSWORD=your-kunmh-password
```

Account commands:

```bat
npm run user -- add EMAIL "Full Name" "password-of-8-or-more"
npm run user -- list
npm run user -- password EMAIL "new-password"     rem also logs the person out everywhere
npm run user -- disable EMAIL
npm run user -- enable EMAIL
```

Database user and database, created by hand (for example in psql as `postgres`):

```sql
CREATE USER kunmh WITH PASSWORD 'your-kunmh-password';
CREATE DATABASE kun_mh OWNER kunmh;
\c kun_mh
GRANT ALL ON SCHEMA public TO kunmh;
```

## Looking at the data

Any of these tools works (all connect to `127.0.0.1`, port `5432`, database `kun_mh`, user `kunmh`):

- **pgAdmin 4**, installed with PostgreSQL: add a server, then browse *kun_mh > Schemas > public > Tables*. Right-click `kv_docs` > *View/Edit Data > All Rows*.
- **psql**, from the PostgreSQL *Command Line Tools*:
  ```bat
  "C:\Program Files\PostgreSQL\16\bin\psql.exe" -h 127.0.0.1 -p 5432 -U kunmh -d kun_mh
  ```
  Useful commands: `\dt` (tables), `\q` (quit), and these queries:
  ```sql
  SELECT coll, count(*) FROM kv_docs GROUP BY coll ORDER BY coll;
  SELECT email, name, active FROM accounts;
  SELECT jsonb_pretty(data) FROM kv_docs WHERE coll = 'cfg' AND id = 'settings';
  ```

Editing rows directly changes what the app sees. Back up first.

## Reset for a clean test

Stop the app first (close its window). Then, as `postgres`:

```sql
DROP DATABASE IF EXISTS kun_mh WITH (FORCE);
DROP ROLE IF EXISTS kunmh;
```

Delete `server\.env` and run the setup scripts again from step 3.

## Backups

The `setup\7-backup.bat` script writes `kun_mh_YYYY-MM-DD_HHMM.sql` into `C:\KUN\backups`. The same thing by hand:

```bat
"C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" -h 127.0.0.1 -U kunmh -d kun_mh -f kun_mh_backup.sql
```

Restore into an empty `kun_mh` database:

```bat
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -h 127.0.0.1 -U kunmh -d kun_mh -f kun_mh_backup.sql
```

## Alternative: portable PostgreSQL (no installer)

Use this only when the official installer cannot be used. This is an unofficial PostgreSQL 16.15 build packaged for npm; it was tested for this app.

1. In a folder such as `C:\pgsql`, run `npm install @embedded-postgres/windows-x64@16.15.0-beta.19`.
2. Set `PGBIN` to `...\node_modules\@embedded-postgres\windows-x64\native\bin` in that folder.
3. Create the data folder with `initdb.exe -D C:\pgdata -U postgres --pwfile=...` (write the superuser password to a temporary file and delete it afterwards), then start it with `pg_ctl.exe -D C:\pgdata -l C:\pgsql\server.log -o "-p 5432" start`.
4. Stop it with `pg_ctl.exe -D C:\pgdata stop`.

The portable build has no `psql` and no `pg_dump`, so use the app's own backup, or install the PostgreSQL 16 Command Line Tools.

## Files

| File | What it does |
|---|---|
| `src\server.js` | Web server: log-in, document API, live updates, serves `index.html` |
| `src\db.js` | PostgreSQL connection pool; applies `schema.sql` at start-up |
| `src\manage.js` | Account commands (`npm run user`) |
| `src\create-database.js` | Creates the app user and database (used by setup step 3) |
| `client\server-adapter.js` | Browser side: sends the app's data requests to this server |
| `schema.sql` | Tables `accounts`, `sessions`, `kv_docs` |
| `.env.example` | Settings template for `.env` |

## Security notes

- The server listens on `127.0.0.1` (this computer only). Setting `HOST=0.0.0.0` exposes it to the network: do this only behind a firewall, with HTTPS in front (for example Caddy, nginx or IIS). Session cookies are not marked `Secure` because the local address is plain HTTP.
- Any log-in the server accepts can read and change all data. Access is limited only by the app's own user roles and log-ins.
- `.env` contains the database password. It is listed in `.gitignore` and `.assetsignore`; do not copy it elsewhere.
