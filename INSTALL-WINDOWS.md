# KUN MH - installation on Windows Server (IIS reverse proxy, Node as an NSSM service, PostgreSQL on localhost)

This document covers one deployment shape: Windows Server, IIS in front as a reverse proxy (Application Request Routing), the Node.js app running as a Windows service through NSSM and bound to `127.0.0.1:<PORT>`, and PostgreSQL on the same machine, listening on localhost. It does not use Docker, Linux paths or PM2.

Placeholders used below:

| Placeholder | Meaning | Example |
|---|---|---|
| `<RELEASE>` | The release folder | `C:\KUN\app` |
| `<PORT>` | The port the app listens on, on 127.0.0.1 only | `3100` |
| `<DATA>` | Folder for logs and reports, outside the release folder | `C:\KUN\data` |
| `<DB_HOST>`, `<DB_PORT>` | PostgreSQL on this machine | `127.0.0.1`, a free port such as `5434` |

The setup scripts in `setup\` are an alternative that does the same steps for an office server. They use the PostgreSQL 16 program folder (`C:\Program Files\PostgreSQL\16`). See section 6.

---

## 1. Node version and global tools

- **Node.js 22.9.0 or newer.** `engines` in `package.json` and `server\package.json` is `>=22.9.0`. The project has no `.nvmrc`. Node 22 LTS is the version the set-up scripts check for and the one used for testing.
- **No global npm packages are needed.** Do not install PM2. Use `npm ci` from the project's own `server\package.json`.
- **NSSM** (the Non-Sucking Service Manager), to run Node as a Windows service. Install it to a fixed folder, for example `C:\Tools\nssm\nssm.exe`, and keep it on the server only.
- **IIS** with the Web Server role, plus two add-ons installed by hand:
  - URL Rewrite 2.1
  - Application Request Routing (ARR) 3.0
- **PostgreSQL 18** on localhost (section 6). The `psql` and `pg_dump` command-line tools must be on the machine for backups and the checks below.

---

## 2. Environment file (`<RELEASE>\server\.env`)

The app reads its settings from the environment. The file is `server\.env`, copied from `server\.env.example`. Node does not read `.env` by itself: the start command in section 4 loads it (`--env-file-if-exists`). If you set the variables in NSSM instead, the file can be left out.

Mark the secret values as protected: restrict the file to the service account and administrators, and never copy it into the repository, e-mail or a shared folder.

| Variable | Required | Secret | Default in code | Example value | Notes |
|---|---|---|---|---|---|
| `PORT` | yes (in practice) | no | `3100` | `3100` | Port for the app. IIS forwards to it. Do not use 3000 (another application) |
| `HOST` | yes (in practice) | no | `127.0.0.1` | `127.0.0.1` | Keep `127.0.0.1`. Other values expose the app without IIS |
| `DB_HOST` | yes, unless `DATABASE_URL` is set | no | `127.0.0.1` | `127.0.0.1` | PostgreSQL on this machine |
| `DB_PORT` | yes, unless `DATABASE_URL` is set | no | `5433` | `<DB_PORT>` | The port of the KUN MH PostgreSQL 18 cluster. Use a port different from the other application's PostgreSQL (5432) |
| `DB_NAME` | yes, unless `DATABASE_URL` is set | no | `kun_mh` | `kun_mh` | |
| `DB_USER` | yes, unless `DATABASE_URL` is set | no | `kunmh` | `kunmh` | |
| `DB_PASSWORD` | yes, unless `DATABASE_URL` is set | **yes** | empty | `<set a strong password>` | Password of `DB_USER` |
| `DATABASE_URL` | no | **yes** | not set | `postgres://USER:PASSWORD@127.0.0.1:5433/kun_mh` | Full connection string. If set, it overrides all `DB_*` values |
| `DB_SSL` | no | no | off | `require` | Turns on TLS. Not needed for PostgreSQL on localhost |
| `DB_POOL_MAX` | no | no | `10` | `10` | Connections per process |
| `DATA_MODE` | no | no | `kv` | `kv` | `kv` keeps documents in `kv_docs`. `tables` uses the relational tables (see README) |
| `COOKIE_SECURE` | no | no | off | `true` | Marks the session cookie `Secure`. Set it only when users reach the app over HTTPS |
| `LIVE_UPDATES` | no | no | on | `on` | Set `off` to disable the database listener used for live updates |

Settings read only by the one-time database set-up (`src\create-database.js`), not by the running service: `PG_PORT`, `PG_SUPERUSER_PASSWORD`, `KUNMH_PASSWORD`. Keep them out of `.env` after set-up. The `KUN_*` variables are read only by the `setup\` scripts.

Example `.env` (placeholders only):

```
PORT=3100
HOST=127.0.0.1
DB_HOST=127.0.0.1
DB_PORT=<DB_PORT>
DB_NAME=kun_mh
DB_USER=kunmh
DB_PASSWORD=<secret>
COOKIE_SECURE=true
```

---

## 3. Build and release folder

There is **no build step**. The app is plain JavaScript and one HTML file. The "build" is installing the server packages and copying the files.

```bat
rem 1. Copy the release (a subset of the repository) to <RELEASE>
rem    Keep this structure. The server reads index.html from the folder above server\.
rem    Include: index.html, rules.js, server\ (src, client, schema.sql, schema-tables.sql,
rem             upgrade-1.9.sql, vendor-names-en.json, package.json, package-lock.json, .env)
rem    Leave out: archive\, api\, vercel.json, .vercel\, server\test\, server\testing\, .git\

rem 2. Install the production packages only
cd <RELEASE>\server
npm ci --omit=dev

rem 3. Check the install
node -e "require('express'); require('pg'); require('bcryptjs'); console.log('ok')"
```

- `npm ci` installs exactly the versions in `server\package-lock.json`. It also removes packages not listed there, so `--omit=dev` leaves only what the app needs at run time. To prune an existing `node_modules` later, run `npm prune --omit=dev` in `<RELEASE>\server`.
- **Build output folder:** none. The release folder is `<RELEASE>` itself, with `node_modules` inside `server\`.
- Run the install from the release folder, not from the repository's root, which holds the Vercel files.

---

## 4. Production start command

From the server folder, with NSSM as the service, the start command is:

```
node --env-file-if-exists=.env src\server.js
```

- Working directory (NSSM `AppDirectory`): `<RELEASE>\server`
- Executable (NSSM `Application`): the full path to `node.exe`, for example `C:\Program Files\nodejs\node.exe`
- Arguments (NSSM `AppParameters`): `--env-file-if-exists=.env src\server.js`

Do not use `npm start`. The `start` script in `server\package.json` runs the same command, but the service should not depend on npm. The `--env-file-if-exists` flag is supported in Node 22.9 and later; it does not fail when `.env` is absent.

NSSM setup (run as administrator, values in angle brackets are yours to fill in):

```bat
C:\Tools\nssm\nssm.exe install KUN-MH "C:\Program Files\nodejs\node.exe" "--env-file-if-exists=.env src\server.js"
C:\Tools\nssm\nssm.exe set KUN-MH AppDirectory "<RELEASE>\server"
C:\Tools\nssm\nssm.exe set KUN-MH Start SERVICE_AUTO_START
C:\Tools\nssm\nssm.exe set KUN-MH AppStdout "<DATA>\logs\server.log"
C:\Tools\nssm\nssm.exe set KUN-MH AppStderr "<DATA>\logs\server.log"
C:\Tools\nssm\nssm.exe set KUN-MH AppRotateFiles 1
C:\Tools\nssm\nssm.exe set KUN-MH AppRotateBytes 10485760
C:\Tools\nssm\nssm.exe start KUN-MH
```

Run the service under a dedicated local account that can read `<RELEASE>` and write `<DATA>\logs`, not as Administrator. Set the account with `nssm set KUN-MH ObjectName`.

---

## 5. How PORT and HOST are read

- `src\server.js` reads `PORT` as `Number(process.env.PORT || 3100)`.
- It reads `HOST` as `process.env.HOST || '127.0.0.1'`.
- The server calls `app.listen(PORT, HOST)`. With `HOST=127.0.0.1` it binds to the loopback interface only. It is not reachable from the network.
- Confirm the binding after start:

```bat
netstat -an | findstr LISTENING | findstr :<PORT>
```

  The line must read `127.0.0.1:<PORT>`. A line with `0.0.0.0:<PORT>` or `[::]:<PORT>` means `HOST` is wrong.

- The start-up log line reads `KUN MH server running at http://localhost:<PORT>`.

---

## 6. Database setup

**PostgreSQL:** version 18, in its own cluster for KUN MH, separate from any other application's PostgreSQL. The cluster listens on `127.0.0.1` only, on a port that is not used by another application (for example 5434). It has a database `kun_mh` and a role `kunmh` that owns it. The app connects over TCP to `<DB_HOST>:<DB_PORT>`.

**Create the cluster** (run as the service account, with the PostgreSQL 18 programs, for example `C:\Program Files\PostgreSQL\18\bin`):

```bat
rem 1. Initialise the data folder, with a superuser password in a file that is deleted afterwards
initdb.exe -D <DATA_DIR> -U postgres -A scram-sha-256 -E UTF8 --pwfile=<PASSWORD_FILE>
del <PASSWORD_FILE>

rem 2. In <DATA_DIR>\postgresql.conf set:
rem    port = <DB_PORT>
rem    listen_addresses = '127.0.0.1'

rem 3. Register and start it as a Windows service
pg_ctl.exe register -N postgresql-kun-18 -D <DATA_DIR> -S auto
net start postgresql-kun-18

rem 4. Check that it listens on 127.0.0.1 only
netstat -an | findstr :<DB_PORT>
```

The steps for the role and the database are in section 6, "Create the role and the database" below. Moving existing data from an older KUN MH database is covered in the server runbook kept with the installation records (it is not in the repository), and in `server\README.md`.

**Extensions:** none. The schema uses `gen_random_uuid()`, which is built into PostgreSQL 13 and later, so `pgcrypto` and `uuid-ossp` are not needed. Do not create them.

**Create the role and database** (psql, as the PostgreSQL superuser):

```sql
CREATE USER kunmh WITH PASSWORD '<secret>';
CREATE DATABASE kun_mh OWNER kunmh;
\c kun_mh
GRANT ALL ON SCHEMA public TO kunmh;
```

The `setup\3-create-database.bat` script does the same and can also create a separate cluster on port 5433. It assumes PostgreSQL 16 program paths, so with PostgreSQL 18 either adjust those paths or do the steps above by hand.

**Schema (migration):**

- `schema.sql` is applied automatically every time the server starts (`src\server.js` calls `applySchema`). It only creates tables that do not exist, so it is safe to run again.
- `schema-tables.sql` is used only by the copy command `npm run migrate:tables` (dry run first, then `--apply --confirm-target <HOST/DB>`). Do not run it by hand.
- `upgrade-1.9.sql` is a one-time data upgrade for installations made before version 1.9. Do not run it on a new install.

**Seed data:** none. The application starts empty. Create the first log-in with:

```bat
cd <RELEASE>\server
npm run user -- add <EMAIL> "<Full name>" "<password of 8 or more>"
```

Masters (items, vendors, users, budget) are loaded from a file with `npm run masters:import -- <FILE> --dry-run`, then without `--dry-run`. The file contains staff details; keep it out of the release folder.

---

## 7. Health check

There is no dedicated health route. Use these two requests:

| Check | Request | Expected |
|---|---|---|
| Process is up | `GET http://127.0.0.1:<PORT>/` | HTTP 200, the HTML of the app |
| App and session handling work | `GET http://127.0.0.1:<PORT>/api/me` with no cookie | HTTP 401, JSON with `"error":"Log in first"` |

A 502 from IIS means the proxy cannot reach the app: the service is stopped or not listening on `<PORT>`.

The database is not checked by these requests. To check it, run `npm run db:status` in `<RELEASE>\server`. It prints the database name, the tables and the record counts, and prints no secrets.

---

## 8. Writable folders

The running app writes **nothing** inside the release folder. Keep the release read-only for the service account.

| Folder | What is written | Where |
|---|---|---|
| Service log | Output of the service (`server.log`) | `<DATA>\logs`, set with `AppStdout` / `AppStderr` in section 4 |
| Reports from the migration commands | Only when `--report <file>` is given | Any folder outside `<RELEASE>`, for example `<DATA>\reports` |
| Backups | Written by the browser as a download (**Admin > Data**), not by the server | The user's download folder |
| Temporary files | None | Not used |
| Uploads | None. Excel import reads the file in the browser | Not used |

Create `<DATA>\logs` and `<DATA>\reports` before the first start, and give the service account write access to them only.

---

## 9. Live updates, upload size and timeouts

**Live updates (SSE and LISTEN/NOTIFY):**

- The browser opens `GET /api/events`, which returns `text/event-stream`. The server sends a comment line every 25 seconds to keep the connection open.
- Changes are passed between processes through PostgreSQL `LISTEN`/`NOTIFY` on one channel. The server holds one dedicated database connection for it. If the connection drops, the server retries.
- IIS must not buffer or time out this stream. Disable response buffering for `/api/events` in the ARR/URL Rewrite rule, and set the ARR forwarding timeout to more than 25 seconds. Check the value in IIS Manager; it is not set by the repository.
- Set `LIVE_UPDATES=off` to turn this off. Users then see changes only after reloading.

**Maximum request body:** 10 MB for JSON (`express.json({ limit: '10mb' })`). There are no file-upload routes.

**Timeouts:**
- Database connection attempt: 10 seconds.
- Any single database query: 20 seconds (`query_timeout`).
- Node's default HTTP request timeout applies to ordinary requests.

The Vercel setting `maxDuration: 30` in `vercel.json` applies only to the hosted site, not to this deployment.

---

## 10. Frontend

The frontend is **not a separate build**. `index.html` (in `<RELEASE>`) is one page. The server reads it and serves it at `/` and `/index.html`, adding the browser adapter `server\client\server-adapter.js`, and serves `rules.js` at `/rules.js`.

- **API base URL:** none to set. The page calls the server with relative paths such as `/api/docs/...`, so it always uses the address it was loaded from.
- Users reach the app through IIS on port 8080 (or 8443 for HTTPS). IIS forwards to `http://127.0.0.1:<PORT>`.

---

## 11. Scheduled jobs and things that must run once

- **Inside the app:** one job, every hour, deletes expired sessions (`DELETE FROM sessions WHERE expires_at <= now()`). It is safe to run in more than one process.
- **Login lock-out** (three wrong passwords, 30 seconds) is kept in the memory of each process. Run **one** instance of the service. With two instances, the lock-out does not apply across them.
- **Must run once, by hand, never from the service:**
  - `npm run migrate:tables` and `npm run migrate:kv` (copies between data layouts)
  - `upgrade-1.9.sql` (old installs only)
  - `npm run masters:import` (replaces master data)
  - `npm run vendors:avl`, `npm run budget:merge`, `npm run roles:fix-1.9`, `npm run vendors:english` (one-time corrections)
- No cron job or Windows scheduled task is needed for the app. Backups are a separate weekly task (`setup\8-backup.bat`).

---

## 12. Updating and rolling back

**Update procedure**

1. Back up the database (`setup\8-backup.bat` or `pg_dump`).
2. Keep a copy of the current `<RELEASE>` folder, for example `<RELEASE>-previous`.
3. Stop the service: `nssm stop KUN-MH`.
4. Copy the new release into `<RELEASE>`, keeping `server\.env`.
5. In `<RELEASE>\server`, run `npm ci --omit=dev`.
6. Start the service: `nssm start KUN-MH`. The schema is applied automatically.
7. Check the health requests in section 7 and the log in `<DATA>\logs\server.log`.

**Rollback**

1. Stop the service.
2. Put the copy from step 2 back in place.
3. Start the service.
4. If the data was changed, restore the backup from step 1.

**Changes that cannot be reversed by putting back the old files**

- `upgrade-1.9.sql` changes job-card priorities (*Urgent* becomes *High*). Restore the backup to undo it.
- `npm run masters:import` replaces master data (items, vendors, users, budget). Restore the backup to undo it.
- `npm run migrate:tables` empties the relational tables and loads them again. Its reverse, `npm run migrate:kv`, has not yet been tested against a real database.
- Switching `DATA_MODE` between `kv` and `tables` changes where new records are written. Records saved in one mode are not in the other until copied back.
- Any data written by the app after an update is kept when the release is rolled back. The old release reads the same database.

**Before any update that changes the database, take a backup and keep it until the new release has run for at least a day.**

---

## Notes on this document

- The app has no dedicated health route. A `/healthz` route would make section 7 simpler; it is not in the code yet.
- The setup scripts assume PostgreSQL 16 program paths. PostgreSQL 18 was tested only with the copy and migration commands on a scratch database, not with the full application under IIS. Test the whole install on a copy of the server first.
- The Node version is not pinned by an `.nvmrc`. Add one (`22`) if you want the version fixed in the repository.
