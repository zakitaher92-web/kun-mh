# KUN MH - local server (technical reference)

The server runs the app on this Windows Server and keeps all records in the KUN MH PostgreSQL 16 database (its own cluster on port 5433). For a normal installation use the scripts in the `setup` folder and [INSTALLATION_GUIDE.md](../INSTALLATION_GUIDE.md). This page explains what the scripts do underneath, and how to run the same steps by hand.

```
office browser  ->  http://SERVER:8080 (IIS)  ->  http://127.0.0.1:3100 (Node.js, Express)  ->  PostgreSQL (database kun_mh, port 5433)
```

Ports used by other applications on the server and never used by KUN MH: 3000 (Billing app), 80 and 443 (Billing IIS site), 5432 (Billing PostgreSQL).

## What the setup scripts do

| Script | Equivalent manual step |
|---|---|
| `setup\1-check-requirements.bat` | Checks Node.js 22.9+, the PostgreSQL programs, IIS URL Rewrite and ARR, and that ports 3100, 8080, 8443 and 5433 are free |
| `setup\2-install-packages.bat` | `npm install` in this folder |
| `setup\3-create-database.bat` | Creates the KUN MH cluster (service `postgresql-kun-16`, port 5433, data in `C:\KUN\pgdata-kun`) if it does not exist, then runs `src\create-database.js`: creates user `kunmh` and database `kun_mh` (safe to re-run) |
| `setup\4-configure.bat` | Writes `.env` and runs `npm run user -- list`, which connects and creates the tables |
| `setup\5-create-admin.bat` | `npm run user -- add EMAIL "NAME" "PASSWORD"` |
| `setup\6-start-app.bat` | Registers the scheduled task `KUN-MH Server`, which runs `setup\run-server.cmd` (`npm start` with output to `logs\server.log`) at startup and restarts it if it stops |
| `setup\stop-app.bat` | Ends the scheduled task and the server process |
| `setup\7-setup-iis.bat` | Installs IIS, writes `iis\web.config` (proxy to `http://127.0.0.1:3100`), creates the `KUN-MH` application pool and site, sets the office ports, opens the firewall for those ports only |
| `setup\check-access.bat` | Read-only check of services, ports, IIS bindings, firewall rules and network reachability |
| `setup\8-backup.bat` | `pg_dump` into `C:\KUN\backups` |

Passwords are typed in hidden. Steps 3 and 4 can also read them from the environment variables `KUN_PG_SUPERUSER_PASSWORD` and `KUNMH_PASSWORD`, which is how the scripts were tested without typing. Ports can be set with `KUN_APP_PORT`, `KUN_PG_PORT`, `KUN_HTTP_PORT` and `KUN_HTTPS_PORT`.

## Manual commands

Run these in the `server` folder.

```bat
npm install
copy .env.example .env          rem then edit .env: DB_PASSWORD must match the kunmh password
npm start                       rem the server; open http://127.0.0.1:3100 on this server, or the IIS address from another computer
```

`.env` settings:

```
PORT=3100
HOST=127.0.0.1

DB_HOST=127.0.0.1
DB_PORT=5433
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

Database user and database, created by hand (for example in psql as the `postgres` user of the KUN MH cluster, port 5433):

```sql
CREATE USER kunmh WITH PASSWORD 'your-kunmh-password';
CREATE DATABASE kun_mh OWNER kunmh;
\c kun_mh
GRANT ALL ON SCHEMA public TO kunmh;
```

## Looking at the data

Any of these tools works (all connect to `127.0.0.1`, port `5433`, database `kun_mh`, user `kunmh`):

- **pgAdmin 4**, installed with PostgreSQL: add a server with port 5433, then browse *kun_mh > Schemas > public > Tables*. Right-click `kv_docs` > *View/Edit Data > All Rows*.
- **psql**, from the PostgreSQL *Command Line Tools*:
  ```bat
  "C:\Program Files\PostgreSQL\16\bin\psql.exe" -h 127.0.0.1 -p 5433 -U kunmh -d kun_mh
  ```
  Useful commands: `\dt` (tables), `\q` (quit), and these queries:
  ```sql
  SELECT coll, count(*) FROM kv_docs GROUP BY coll ORDER BY coll;
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

The `setup\8-backup.bat` script writes `kun_mh_YYYY-MM-DD_HHMM.sql` into `C:\KUN\backups`. The same thing by hand:

```bat
"C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" -h 127.0.0.1 -p 5433 -U kunmh -d kun_mh -f kun_mh_backup.sql
```

Restore into an empty `kun_mh` database:

```bat
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -h 127.0.0.1 -p 5433 -U kunmh -d kun_mh -f kun_mh_backup.sql
```

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
| `src\server.js` | Web server: log-in, document API, live updates, serves `index.html` |
| `src\db.js` | PostgreSQL connection pool; applies `schema.sql` at start-up |
| `src\manage.js` | Account commands (`npm run user`) |
| `src\create-database.js` | Creates the app user and database (used by setup step 3) |
| `client\server-adapter.js` | Browser side: sends the app's data requests to this server |
| `schema.sql` | Tables `accounts`, `sessions`, `kv_docs` |
| `.env.example` | Settings template for `.env` |

## Security notes

- The app listens on `127.0.0.1` (this server only). Keep it that way: the supported setup puts IIS in front (`setup\7-setup-iis.bat`), which applies the network restriction and HTTPS. Setting `HOST=0.0.0.0` would expose the app without IIS and is not supported. Session cookies are not marked `Secure`, so they rely on HTTPS in IIS for protection on the network.
- The KUN MH database listens on `localhost` only (port 5433). `setup\check-access.bat` confirms that it does not answer from the network.
- Any log-in the server accepts can read and change all data. Access is limited only by the app's own user roles and log-ins.
- `.env` contains the database password. It is listed in `.gitignore`; do not copy it elsewhere.
