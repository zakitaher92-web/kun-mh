# KUN Maintenance & Housekeeping - Installation Guide (office server)

This guide installs the KUN MH app on one Windows Server, for the office. It is for **version 2.2.0**. Other documents:

- [UPGRADE-HISTORY.md](UPGRADE-HISTORY.md): the upgrades of 1.9, 1.9.2 and 2.2.0 for servers that were installed earlier.
- [HOSTED-VERCEL.md](HOSTED-VERCEL.md): the hosted site on Vercel and the move of its database to tables.

The app runs as a Node.js service. Its records are in a database of the **shared PostgreSQL 18 cluster** on the same server. **IIS** receives the requests from the office network and passes them to the app. Other people open the app in a browser; they do not install anything.

```
Office browsers  ->  IIS on the server (8080, or 8443 with HTTPS)
                       ->  KUN app (127.0.0.1:3100, private)
                             ->  PostgreSQL 18 cluster, service postgresql-x64-18
                                   127.0.0.1:5432, database kun_mh (only KUN MH's own database and role)
```

## Read this first: the shared database cluster

- The PostgreSQL 18 cluster (service **postgresql-x64-18**, port **5432**) is **shared** with the Billing application. KUN MH does **not** create a new cluster. It adds one role (`kunmh`) and one database (`kun_mh`) to the cluster.
- **Stopping the service `postgresql-x64-18` stops every application that uses this cluster, including the Billing app.** Stop it only with the Billing app's owner agreeing.
- KUN MH never edits `postgresql.conf` or `pg_hba.conf`, and never touches other databases or roles. The set-up scripts print the `pg_hba.conf` line the app needs; the administrator adds it by hand.
- The cluster's `listen_addresses` should be `localhost`. Step 1 reports its value. If it is not localhost, the cluster can be reached from the network; ask the owner of the Billing app to change it.

**Ports used by KUN MH**

| Service | Port | Reachable from | Set by |
|---|---|---|---|
| IIS, HTTP (office users) | **8080** | Office network (firewall rule) | Step 7 |
| IIS, HTTPS (office users) | **8443** | Office network (firewall rule) | Step 7 (only with a certificate) |
| KUN app (Node) | **3100** | This server only (127.0.0.1) | `PORT` in `server\.env` (step 4) |
| PostgreSQL 18 (shared, service `postgresql-x64-18`) | **5432** | This server only (127.0.0.1) | `DB_PORT` in `server\.env` (step 4) |

**Ports used by other applications on this server, never by KUN MH:** **3000** (Billing app), **80** and **443** (Billing IIS site), and the IIS website **Default Web Site** (NKERP), which the scripts never stop.

**Which part to follow**

| You want to | Go to |
|---|---|
| Install a new office server with the set-up scripts (recommended) | Parts 1, 2 and 3, then 5 to 10 |
| Install by hand, with Node as an NSSM service and IIS as a reverse proxy | Parts 1, 2 and 4, then 5 to 10 |
| Move the data from an existing PostgreSQL 16 database (service `postgresql-kun-16`, port 5433) | Part 12, first |
| Update an installed server to version 2.2.0 | Part 11 |
| Give the office server a copy of the hosted (Neon) database, running in tables mode | Part 13 |
| Upgrade a server installed before 2.2.0 (1.9, 1.9.2) | [UPGRADE-HISTORY.md](UPGRADE-HISTORY.md) |
| The hosted site on Vercel | [HOSTED-VERCEL.md](HOSTED-VERCEL.md) |

**Before you start**

- You need an administrator account on the server, and the server must be on the office network.
- Use Node.js **22 LTS** (22.9.0 or newer).
- Install the application in a permanent folder such as `C:\KUN\kun-mh`. Not in Downloads, on a network share, or under `C:\Users\`.
- The package folder holds `setup\`, `server\`, `index.html`, `rules.js`. The Vercel-only files (`api\`, `vercel.json`, `HOSTED-VERCEL.md`) are not used on the office server.
- The server's clock and time zone must be set to **Baghdad time (UTC+3)** (Part 9, "Time zone").

---

## Part 1 - Prerequisites (check once, by hand)

### 1a. Node.js 22 LTS
1. Run `node -v` in Command Prompt. It must show `v22.9.0` or newer. If not, install Node.js 22 LTS from https://nodejs.org, then open a new window.
2. No global npm packages are needed. Do not install PM2.

### 1b. PostgreSQL 18 (already installed on the server)
1. The service **postgresql-x64-18** must exist and be **Running**, with startup type **Automatic**.
2. The programs must be in `C:\Program Files\PostgreSQL\18\bin` (with the Command Line Tools, which give `psql`, `pg_dump` and `pg_restore`).
3. The cluster must answer on **127.0.0.1:5432**.
4. **Do not** create a new cluster, and do not change the Billing app's service, its port, or its configuration files.
5. If the server runs PostgreSQL 16 for KUN MH (service `postgresql-kun-16`), the data must be moved first: Part 12.

### 1c. URL Rewrite 2.1 (IIS add-on, install by hand)
Download the x64 installer from https://www.iis.net/downloads/microsoft/url-rewrite and run it with the default options.

### 1d. Application Request Routing 3.0 (IIS add-on, install by hand)
Download the installer from https://www.iis.net/downloads/microsoft/application-request-routing and install it **after** URL Rewrite, with the default options.

### 1e. HTTPS certificate (recommended)
A certificate belongs to a **name**. The Billing certificate can be reused if it covers the name that KUN MH users type. Note its **thumbprint** (Part 8). You can start without a certificate.

### 1f. Server name
IT should add the server name to DNS, or the name must be known on the office network.

### 1g. NSSM (Route B only)
NSSM (the Non-Sucking Service Manager) runs Node as a Windows service. Install it to a fixed folder, for example `C:\Tools\nssm\nssm.exe`. The set-up scripts (Route A) do not use NSSM.

---

## Part 2 - Choose the install route

| | Route A - set-up scripts | Route B - manual, NSSM service |
|---|---|---|
| Who it is for | The usual office server | An administrator who wants each step visible |
| App runs as | Scheduled task **KUN-MH Server**, as the local account **kunapp** | Windows service **KUN-MH** (NSSM), as the local account **kunapp** |
| Database role and database | Created by step 3 | Created by hand (section 4.3) |
| IIS | Set up by step 7 | Set up by hand (section 4.6) |

Use one route per server.

---

## Part 3 - Route A: set-up scripts

Open the `setup` folder inside `kun-mh`. For each step, **right-click** the `.bat` file and choose **Run as administrator**. Run the steps in order.

| Step | File | What it does |
|---|---|---|
| 1 | `1-check-requirements.bat` | Checks Node.js 22.9+, PostgreSQL 18 (version and programs), the service **postgresql-x64-18** (running, on port 5432), the value of `listen_addresses` (warns if not localhost), the Windows time zone (Arabic Standard Time, Baghdad: warns otherwise), IIS URL Rewrite and ARR, and the KUN MH ports. Fix anything marked **FAIL**. |
| 2 | `2-install-packages.bat` | Installs the server packages (`npm ci`). One time only. |
| 3 | `3-create-database.bat` | Creates the role **kunmh** and the database **kun_mh** on the shared cluster. Asks for the password of the `postgres` user. Prints the `pg_hba.conf` line (see below). Does not create a cluster. Safe to run again. |
| 4 | `4-configure.bat` | Writes `server\.env` (defaults in Part 5) and tests the connection. Keeps the `COOKIE_SECURE` line of the previous settings. |
| 5 | `5-create-admin.bat` | Creates the log-in accounts. Repeat for each person. |
| 6 | `6-start-app.bat` | Creates the local account **kunapp**, and registers the app as a scheduled task that runs as **kunapp** (not SYSTEM). Starts the app. |
| 7 | `7-setup-iis.bat` | Sets up IIS for the app on the office ports, with the firewall rule. Never stops **Default Web Site**. |
| 8 | `8-backup.bat -Register` | Creates the nightly backup task **KUN-MH Backup** (02:00, as **kunapp**). `8-backup.bat` alone runs one backup now. |
| - | `check-access.bat` | Read-only check, any time. |
| - | `check-events.bat` | Live-update stream test, through IIS or directly (Part 9). Logs in with a test account. |

**Step 3 in detail**

1. Asks for the password of the PostgreSQL `postgres` user (the superuser of the shared cluster). The password is used for this step only and is not stored.
2. Asks for a new password for the app user `kunmh`. Write it down: step 4 asks for it again.
3. Creates the role `kunmh` (or sets its new password if it exists), with a login.
4. Creates the database `kun_mh`, owned by `kunmh`, UTF-8, from `template0` (only if it does not exist).
5. Revokes all access to `kun_mh` from PUBLIC, and sets the database time zone to `Asia/Baghdad`.
6. Gives `kunmh` the right to use the `public` schema of `kun_mh`. No extensions are needed.
7. Checks `pg_hba.conf` (read only). If there is no rule for `kunmh` on 127.0.0.1, it **prints** the line to add:
   ```
   host    kun_mh    kunmh    127.0.0.1/32    scram-sha-256
   ```
   Add it yourself to `pg_hba.conf` of the cluster, **above any reject rule**, then reload the configuration with `SELECT pg_reload_conf();` (a reload: no application stops). Step 3 never edits the file. Restart the service `postgresql-x64-18` only when `listen_addresses` changes, because a restart stops the Billing app too: plan that with its owner.

**Step 4 in detail:** the defaults are `DB_HOST=127.0.0.1`, `DB_PORT=5432`, `DB_NAME=kun_mh`, `DB_USER=kunmh`, `TZ=Asia/Baghdad`. An old `server\.env` is saved as `server\.env.bak`; its `COOKIE_SECURE` line is kept.

**Step 7 questions:** the networks allowed to open the app; the certificate thumbprint (optional); the ports (Enter for 8080 and 8443). If a port is used by another IIS website, the step asks before stopping it, except **Default Web Site**, which is refused.

After step 7, run `check-access.bat`, then log in with the first account from another computer.

---

## Part 4 - Route B: manual install

Placeholders: `<RELEASE>` = the release folder (for example `C:\KUN\kun-mh`); `<PORT>` = the app port (3100); `<DATA>` = a folder for logs and reports outside the release (for example `C:\KUN\data`); `<PG_BIN>` = `C:\Program Files\PostgreSQL\18\bin`.

### 4.1 Release folder and packages

Copy the release: `index.html`, `rules.js`, and `server\` (its `src`, `client`, `schema.sql`, `schema-tables.sql`, `upgrade-1.9.sql`, `vendor-names-en.json`, `package.json`, `package-lock.json`). Leave out `archive\`, `api\`, `vercel.json`, `HOSTED-VERCEL.md`, `.vercel\`, `server\test\`, `server\testing\`, `.git\`.

```bat
cd <RELEASE>\server
npm ci --omit=dev
```

There is no build step. `npm ci --omit=dev` installs exactly the packages in `package-lock.json`, without development packages.

### 4.2 Settings file

Create `<RELEASE>\server\.env` from `server\.env.example` and fill in the values from Part 5. Restrict the file to administrators and the account `kunapp`.

### 4.3 Database role and database (by hand)

Connect as the `postgres` superuser of the shared cluster (`"<PG_BIN>\psql.exe" -h 127.0.0.1 -p 5432 -U postgres`), then run:

```sql
CREATE ROLE kunmh WITH LOGIN PASSWORD '<new kunmh password>';   -- ALTER ROLE ... if it exists
CREATE DATABASE kun_mh OWNER kunmh ENCODING 'UTF8' TEMPLATE template0;
REVOKE ALL ON DATABASE kun_mh FROM PUBLIC;
ALTER DATABASE kun_mh SET timezone = 'Asia/Baghdad';
\c kun_mh
GRANT ALL ON SCHEMA public TO kunmh;
```

Then add the `pg_hba.conf` line from Part 3, step 3 (by hand, above any reject rule), and reload with `SELECT pg_reload_conf();` (as `postgres`; no restart). Do not change any other database or role.

### 4.4 Start command and the NSSM service

The start command, run from `<RELEASE>\server`:

```
node --env-file-if-exists=.env src\server.js
```

Create the service (replace the placeholders):

```bat
C:\Tools\nssm\nssm.exe install KUN-MH "C:\Program Files\nodejs\node.exe" "--env-file-if-exists=.env src\server.js"
C:\Tools\nssm\nssm.exe set KUN-MH AppDirectory "<RELEASE>\server"
C:\Tools\nssm\nssm.exe set KUN-MH ObjectName ".\kunapp" "<password of kunapp>"
C:\Tools\nssm\nssm.exe set KUN-MH DependOnService postgresql-x64-18
C:\Tools\nssm\nssm.exe set KUN-MH Start SERVICE_DELAYED_AUTO_START
C:\Tools\nssm\nssm.exe set KUN-MH AppExit Default Restart
C:\Tools\nssm\nssm.exe set KUN-MH AppRestartDelay 5000
C:\Tools\nssm\nssm.exe set KUN-MH AppRotateOnline 1
C:\Tools\nssm\nssm.exe set KUN-MH AppStdout "<DATA>\logs\server.log"
C:\Tools\nssm\nssm.exe set KUN-MH AppStderr "<DATA>\logs\server.log"
C:\Tools\nssm\nssm.exe set KUN-MH AppRotateFiles 1
C:\Tools\nssm\nssm.exe set KUN-MH AppRotateBytes 10485760
C:\Tools\nssm\nssm.exe start KUN-MH
```

Give `kunapp` read access to `<RELEASE>` and modify access to `<DATA>\logs` (Route A does this in step 6). The service runs as `kunapp`, not as SYSTEM and not as an administrator. What each setting does:

- `DependOnService postgresql-x64-18`: Windows starts the service after the database service.
- `SERVICE_DELAYED_AUTO_START`: the service starts shortly after the other automatic services, which gives PostgreSQL time to start first.
- `AppExit Default Restart` with `AppRestartDelay 5000`: when the app exits, NSSM starts it again after 5 seconds.
- `AppRotateOnline 1` with `AppRotateFiles 1` and `AppRotateBytes 10485760`: NSSM rotates `server.log` while the app runs, when it reaches 10 MB, and keeps one older copy. **The name of the older copy and the retention are not checked on a server yet** (NSSM was not installed when this guide was written). Check after the first rotation, and adjust the cleanup below if the name differs.

Cleanup of old logs (run daily with Task Scheduler as an administrator, or by hand, deletes rotated copies older than 14 days):

```bat
forfiles /P "<DATA>\logs" /M "server.log.*" /D -14 /C "cmd /c del /q @path"
```

### 4.5 Check the binding and the health

`src\server.js` reads `PORT` (default 3100) and `HOST` (default 127.0.0.1). Check: `netstat -an | findstr LISTENING | findstr :<PORT>`; the line must read `127.0.0.1:<PORT>`. Health checks: Part 9.

### 4.6 IIS as a reverse proxy (ARR)

1. Install the Web Server role, then URL Rewrite and ARR (Parts 1c and 1d).
2. In IIS Manager: **Application Request Routing Cache > Server Proxy Settings**, tick **Enable proxy**, and set the timeout to more than 25 seconds.
3. Create a site `KUN-MH` on port **8080** (not 80, 443, 3000, or the port of Default Web Site), with an empty physical folder and its own application pool `KUN-MH` (No Managed Code).
4. Add a URL Rewrite **reverse proxy** rule to `http://127.0.0.1:<PORT>/{R:0}`. Turn off response buffering for `/api/events` (the live-update stream).
5. Open the firewall for port 8080 from the office network only (rule `KUN-MH IIS port 8080`).
6. For HTTPS (optional), bind port 8443 with the certificate (Part 8), then set `COOKIE_SECURE=true`.

---

## Part 5 - Configuration reference (`server\.env`)

Both routes use the same settings. Values marked **secret** must never be shared, e-mailed, or put in the repository.

| Variable | Required | Secret | Default (scripts) | Example | Notes |
|---|---|---|---|---|---|
| `PORT` | yes | no | `3100` | `3100` | The app port. IIS forwards to it |
| `HOST` | yes | no | `127.0.0.1` | `127.0.0.1` | Keep `127.0.0.1` |
| `DB_HOST` | yes, unless `DATABASE_URL` | no | `127.0.0.1` | `127.0.0.1` | The shared cluster, on this server |
| `DB_PORT` | yes, unless `DATABASE_URL` | no | `5432` | `5432` | The shared PostgreSQL 18 cluster. An old `5433` from a PostgreSQL 16 install is replaced by step 4 |
| `DB_NAME` | yes, unless `DATABASE_URL` | no | `kun_mh` | `kun_mh` | |
| `DB_USER` | yes, unless `DATABASE_URL` | no | `kunmh` | `kunmh` | |
| `DB_PASSWORD` | yes, unless `DATABASE_URL` | **yes** | set in step 4 | `<secret>` | Password of `DB_USER` |
| `DATABASE_URL` | no | **yes** | not set | `postgres://USER:PASSWORD@127.0.0.1:5432/kun_mh` | Full connection string. Overrides `DB_*` (used for the hosted site) |
| `DB_SSL` | no | no | off | `require` | TLS. Not needed on localhost; needed for Neon |
| `DB_POOL_MAX` | no | no | `10` | `10` | Connections per process |
| `TZ` | yes (office) | no | `Asia/Baghdad` | `Asia/Baghdad` | Time zone of the server's dates (Part 9) |
| `DATA_MODE` | no | no | `kv` | `kv` | `kv` (office). `tables` only after the hosted cutover (HOSTED-VERCEL.md) |
| `COOKIE_SECURE` | no | no | off | `true` | Only when users reach the app over HTTPS. Kept by step 4 |
| `LIVE_UPDATES` | no | no | on | `on` | `off` disables the live-update listener |
| `DB_WAIT_SECONDS` | no | no | `300` | `300` | How long the app waits at start-up for PostgreSQL to accept connections (Part 9) |

Setup-only variables (read by the scripts, not by the running app): `KUN_PG_SUPERUSER_PASSWORD`, `KUNMH_PASSWORD`, `KUN_PG_PORT`, `KUN_APP_PORT`, `KUN_HTTP_PORT`, `KUN_HTTPS_PORT`, `KUN_STOP_CONFLICTS`.

Example `.env`, with placeholders:

```
PORT=3100
HOST=127.0.0.1
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=kun_mh
DB_USER=kunmh
DB_PASSWORD=<secret>
TZ=Asia/Baghdad
COOKIE_SECURE=true
```

---

## Part 6 - Database

- **Cluster:** PostgreSQL 18, service `postgresql-x64-18`, shared with the Billing app. KUN MH uses only the role `kunmh` and the database `kun_mh` (Part 3, step 3).
- **Schema:** `schema.sql` is applied each time the server starts. It only creates missing tables, so it is safe to run again.
- **Extensions:** none. The schema uses `gen_random_uuid()`, which is built into PostgreSQL 13 and later.
- **Seed data:** none. The app starts empty, unless the first log-in chooses the example data (Part 3, after step 7).
- **First log-in (Route B, or by hand):** `npm run user -- add <EMAIL> "<Full name>" "<password of 8 or more>"` in `<RELEASE>\server`.
- **Masters** (items, vendors, users, budget): `npm run masters:import -- <FILE> --dry-run`, then without `--dry-run`. The file contains staff details; keep it off the release folder.
- **Accounts:** `npm run user -- list | add | password | disable | enable`.
- **Other database commands:** `npm run db:status` (tables and record counts, no secrets printed).

---

## Part 7 - Everyday use and backups

| Task | How |
|---|---|
| Start the app | `setup\6-start-app.bat` (or `nssm start KUN-MH`). It also starts after a restart |
| Stop the app | `setup\stop-app.bat` (or `nssm stop KUN-MH`). Users then see an error page |
| Check the app's log | `kun-mh\logs\server.log` (rotation: Part 9) |
| Check the database | `npm run db:status` in `server` |
| **Start or stop the database** | **services.msc > postgresql-x64-18. Stopping it stops the Billing app and KUN MH.** |
| Check access | `setup\check-access.bat` |
| Add a person | `setup\5-create-admin.bat` |
| Change a password, or block a leaver | `npm run user -- password EMAIL "NEW"` or `npm run user -- disable EMAIL` |
| Restart IIS | `iisreset` (Command Prompt as administrator) |

**Nightly backup (step 8).** `8-backup.bat -Register` creates the task **KUN-MH Backup**, which runs every night at 02:00 as `kunapp`. Each run writes `C:\KUN\backups\kun_mh_YYYY-MM-DD_HHMM.dump` (`pg_dump -Fc`, the custom format), and deletes `kun_mh_*.dump` files older than **14 days**. Its log is `kun-mh\logs\backup.log`. Run one by hand with `8-backup.bat`. Copy the backups to another drive or server each week.

**Restore a backup** (into the existing database, replacing its objects; stop the app first):

```bat
"C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" -h 127.0.0.1 -p 5432 -U kunmh -d kun_mh --clean --if-exists --no-owner --no-privileges -v C:\KUN\backups\kun_mh_<date>.dump
```

To check a backup without touching the live database, restore it into a new scratch database created by the owner (`CREATE DATABASE kun_mh_check OWNER kunmh;`) with the same command, check the counts, and drop the scratch database afterwards. Never restore into another application's database.

In the app, **Admin > Data** also offers a backup download and a restore (type `RESTORE` to confirm).

---

## Part 8 - Use from other computers, and HTTPS

**Address:** `http://<server name>:8080/` or `http://<IP address>:8080/`.

**Test once from another computer:** the log-in page must appear, and an account from step 5 must log in. If HTTPS is set up, `https://<server name>:8443/` must show a padlock with the certificate name.

**If other computers cannot open it:** run `check-access.bat`; check that the other computer is on an allowed network (step 7); try the IP address; check the firewall rule `KUN-MH IIS port 8080`; check the network profile (*Private* or *Domain*).

**What must stay closed:** only IIS (8080, 8443) answers from the network. Ports 3100 (the app) and 5432 (the database) must not be reachable from other computers. Port 5432 is shared with the Billing app: the firewall must block it from the network (`check-access` reports this as a warning).

**HTTPS:**
1. Ask IT for a certificate for the server's name, in **Local Computer > Personal**.
2. Thumbprint: Win+R, `certlm.msc`, **Personal > Certificates**, double-click the certificate, **Details > Thumbprint**. Remove the spaces.
3. Route A: run `setup\7-setup-iis.bat` again and paste the thumbprint. Route B: bind the certificate to port 8443 in IIS Manager.
4. Once HTTPS works, set `COOKIE_SECURE=true` in `server\.env` and restart the app.

---

## Part 9 - Runtime notes and checks

**Health checks**

| Check | Request or command | Expected |
|---|---|---|
| App process is up | `GET http://127.0.0.1:<PORT>/` | HTTP 200, the app page |
| App and sign-in work | `GET http://127.0.0.1:<PORT>/api/me` with no cookie | HTTP 401, `"Log in first"` |
| Database | `npm run db:status` | Database name, tables, counts; no secrets |
| Time zone | `node --env-file-if-exists=.env -e "console.log(new Date().toString())"` in `server` | a time with `+0300` |

A 502 from IIS means the app is not answering on `<PORT>`. There is no dedicated health route.

**Time zone.** The business time zone is **Asia/Baghdad (UTC+3, no daylight saving)**. It is set in four places:
- **The server (Node):** `TZ=Asia/Baghdad` in `server\.env`. Dates made by the server (audit log times, the log's timestamps) use it. Node reads `TZ` when the app starts, so a change needs a restart.
- **The database:** `ALTER DATABASE kun_mh SET timezone = 'Asia/Baghdad'` (step 3). Sessions of the app use it. Columns declared `TIMESTAMPTZ` are stored in UTC and shown in this zone.
- **The page (browser):** "today", the report date and the date defaults are computed in Asia/Baghdad time, whatever the computer's own time zone (version 2.2.0). Excel dates are read as calendar dates.
- **The computers and the server clock:** the Windows time zone of the server must be the one with the ID **Arabic Standard Time** (display name *(UTC+03:00) Baghdad*). Check with `tzutil /g` (it prints the ID), and set it with `tzutil /s "Arabic Standard Time"`. Step 1 warns if it is different. Keep the clock synchronised. The times in the audit log and the backups depend on it.

**Log rotation (the app's log).** The launcher `setup\run-server.cmd` (used by the scheduled task) checks `logs\server.log` each time the app starts. A log larger than **10 MB** is renamed to `server-YYYYMMDD-HHMMSS.log`, and rotated logs older than **14 days** are deleted. The check runs at each start, so a server that runs for weeks without a restart keeps writing to one file until its next start. Route B (NSSM) rotates the log while the app runs, at 10 MB; see Part 4.4 for the settings and the cleanup.

**Which Windows account runs the tasks.** The app task **KUN-MH Server** and the backup task **KUN-MH Backup** run as the local account **`kunapp`**, which is not an administrator and not SYSTEM. Step 6 creates it with a random password, and grants it read access to the release folder and modify access to `logs` and `C:\KUN\backups`. Windows keeps the password for the tasks; step 8 `-Register` gives the account a new password and registers both tasks again.

**Writable folders:** `logs` (in the release folder for Route A, `<DATA>\logs` for Route B), `C:\KUN\backups`, and the report folder of the migration commands. The release folder itself is read-only for `kunapp`. There are no uploads: the Excel import reads the file in the browser.

**Live updates.** The browser opens `GET /api/events` (server-sent events), which sends a comment line every 25 seconds. Changes pass between processes through PostgreSQL `LISTEN`/`NOTIFY`. IIS must not buffer this stream, and its forwarding timeout must be longer than 25 seconds. `LIVE_UPDATES=off` turns it off.

**Request size and timeouts.** JSON bodies up to 10 MB. A database connection attempt waits up to 10 seconds; a query up to 20 seconds.

**Frontend.** `index.html` is one page, with no build step. It calls the server with relative paths (`/api/...`), so no API address is set.

**Restart and retry behaviour (Route A).**

- **The app task `KUN-MH Server`** runs as `kunapp` whether or not anyone is logged on. It starts 60 seconds after Windows starts (so PostgreSQL has time to start), has no time limit, and is not stopped by battery settings. If the app exits with an error, the task restarts it every minute, up to 999 times. A second start while one is running is ignored.
- **The database at boot.** If PostgreSQL is not ready yet, the app does not exit at once. It retries the connection every 5 seconds for up to `DB_WAIT_SECONDS` (default 300 seconds), and logs each attempt as `Database not ready (attempt n)`. If PostgreSQL is still not reachable after that, the app exits with an error, and the task restarts it a minute later.
- **Live-update listener.** The connection that carries the live updates retries every 3 seconds if it drops.

**How the nightly backup connects.** The backup task `KUN-MH Backup` runs as the Windows account `kunapp`. Windows does not log in to PostgreSQL with that account. The backup script reads `DB_PASSWORD` from `server\.env` and gives it to `pg_dump` in the environment variable `PGPASSWORD`, for the length of the dump only. The database user is `kunmh`. No `pgpass.conf` file is created. Step 8 with `-Register` gives `kunapp` a new Windows password and registers both tasks again. That does not change `DB_PASSWORD`, so the backup keeps working. If the `kunmh` password changes, change `DB_PASSWORD` in `server\.env` (or run step 4 again).

**The cookie behind IIS (COOKIE_SECURE).** The app marks the session cookie `Secure` when `COOKIE_SECURE=true`. It does not look at proxy headers: the decision is made from the setting. IIS receives the HTTPS request, and passes it to the app on 127.0.0.1 as plain HTTP; the app's answer carries the `Secure` flag, and the browser, which uses HTTPS, keeps the cookie. Over plain `http://` the browser drops a `Secure` cookie, so the log-in fails. Step 7 redirects `http://` to `https://` when a certificate is set, so users are sent to HTTPS. `check-access.bat` warns if `COOKIE_SECURE=true` and the site has no HTTPS binding.

**Checking the live-update stream.** Run `setup\check-events.bat https://<server name>:8443` (through IIS), and then `setup\check-events.bat http://127.0.0.1:3100` (the app directly). The test logs in with a test account and checks that the response type is `text/event-stream`, that its first line arrives within 5 seconds (nothing is held back), and that a keep-alive line arrives within 35 seconds. If the first line is late, IIS is buffering or compressing the stream. The site's `web.config` (written by step 7) has `responseBufferLimit="0"`, and turns off dynamic compression (`urlCompression doDynamicCompression="false"`). Check both in IIS Manager after a change.

**Scheduled work and the single-instance rule.**
- Inside the app: an hourly job deletes expired sessions (safe with several processes).
- The login lock-out (three wrong passwords, 30 seconds) is kept in each process's memory. Run **one** instance of the app.
- Only the two tasks above run on their own. The one-time commands (migrations, masters import, `upgrade-1.9.sql`, the vendor and budget corrections) are run by hand, never by a task.

---

## Part 10 - Troubleshooting

| Message or symptom | What to do |
|---|---|
| `Node.js is not installed` or `too old` (step 1) | Install Node.js 22 LTS (Part 1a), open a new window, run step 1 again |
| `The PostgreSQL 18 programs were not found` or `PostgreSQL 18 is required` (step 1, 3) | Install PostgreSQL 18 with the Command Line Tools (Part 1b). Only the 18.x programs are supported |
| `The PostgreSQL service postgresql-x64-18 was not found` (step 1 or 3) | The shared cluster is not installed or has another service name. Install PostgreSQL 18 with its default service name (Part 1b). Do not create another cluster |
| `The service postgresql-x64-18 is not running` (step 1 or 3) | Start it in services.msc. This also starts the Billing app's database. Check first that nobody else is using it |
| `Nothing answers on port 5432` (step 1, 3 or 4) | The service is stopped, or the cluster listens on another address. Check the service and `listen_addresses` (step 1) |
| `listen_addresses = '<value>'` (warning, step 1) | The cluster accepts network connections. Ask the owner of the Billing app to set it to `localhost`. KUN MH does not change it |
| `pg_hba.conf` line printed (step 3) | Add the printed line to `pg_hba.conf` yourself, above any reject rule, and run `SELECT pg_reload_conf();` as `postgres` (a reload: nothing stops). Then run step 4 again |
| `could not connect` / *password authentication failed for user "kunmh"* | The `DB_PASSWORD` in `server\.env` does not match `kunmh`. Run step 3 and then step 4 again with the same password |
| `The postgres user is not allowed to do this (insufficient privilege)` (step 3) | The password is not the superuser's, or the `postgres` user is not a superuser. Check the password. The step does not change superuser rights |
| `Port 3100 is already in use` (step 6) | The app is running already. Run `stop-app.bat` first, then start it again |
| `IIS answered with status 502` or `500` | The app is not running. Start it, then check the log |
| `Port 8080 is in use by the IIS website 'Default Web Site'` (step 7) | **Default Web Site is never stopped by this step.** Choose another port (not 80, 443, 3000, 5432) |
| `Port 8080 is already in use by another program` (step 7) | Choose another port in step 7 |
| `No certificate with thumbprint` (step 7) | Check the thumbprint and the certificate location |
| *Loading the shared data* | Reload the page. Check the log |
| *502 Bad Gateway* or an IIS error page | The app is stopped. Start it |
| `Live-update connection lost, reconnecting` in the log | The app retries by itself. If it stays, check that `postgresql-x64-18` is running |
| *Your role may not change this page* | Check **Admin > Access rights**. The Head of Accounts can change it |
| A page shows no records, or *Nothing here yet* | The role cannot see those pages. Check **Admin > Access rights** |
| `Type RESET exactly to confirm` / `Type RESTORE exactly to confirm` | The word was not typed exactly (capitals). Nothing was done |
| The nightly backup did not run, or `backup.log` shows an error | Check that `postgresql-x64-18` was running at 02:00. Run `8-backup.bat` by hand to see the message. `pg_dump` must be from PostgreSQL 18 |
| `The app is in a user profile folder` (step 7) | Move the folder to `C:\KUN\kun-mh`, then run steps 6 and 7 from there |
| Dates are one day behind (before 03:00) | Use version 2.2.0 or later (dates in Baghdad time). Check the time zone (Part 9) |
| Times in the log are wrong by three hours | Check that `TZ=Asia/Baghdad` is in `server\.env`, and restart the app |
| The log does not rotate | Route A: rotation happens when the app starts; restart it to rotate a large log. Route B: check NSSM's rotation after its first rotation (Part 4.4) |
| The log-in fails on `http://` but works on `https://` | With `COOKIE_SECURE=true` the browser keeps the cookie only over HTTPS. Use the `https://` address (step 7 redirects there when a certificate is set), or remove `COOKIE_SECURE` (Part 9) |
| `check-events` says the first line is late, or no keep-alive arrives | IIS is buffering or compressing the stream. Check `responseBufferLimit="0"` and `doDynamicCompression="false"` in the site's `web.config`, and the ARR forwarding timeout (more than 25 seconds). Run step 7 again to rewrite `web.config` |
| The app stops at start-up with `Database not ready` and then `Could not start the server` | PostgreSQL was not reachable for `DB_WAIT_SECONDS` (default 300). Start `postgresql-x64-18`, check the port (step 1), and the task starts the app again within a minute |
| Step 1 warns about the time zone | Set Windows to Baghdad time: `tzutil /s "Arabic Standard Time"`, check with `tzutil /g`, then restart the app |
| `fc` shows differences after the data move (Part 12, step 6) | Do not switch the app. Find the table that differs, check the restore output for that table, and repeat step 5 with `--clean --if-exists` if needed |
| Both KUN-MH tasks stop running after someone changed the `kunapp` password by hand | The tasks keep the old password, so Windows cannot start them. Run `setup\8-backup.bat -Register` (as administrator): it gives `kunapp` a new password and registers both tasks again. Do not change `kunapp`'s password by hand |
| Step 3 or 4 says `The database service ... was not found` | Install PostgreSQL 18 (Part 1b) and run step 3 again |

When you report a problem, send the text of the script window, the output of `check-access.bat`, and the last lines of `logs\server.log`.

---

## Part 11 - Updating an installed server

Use this for any update to version 2.2.0 or later. Upgrades of older versions are in [UPGRADE-HISTORY.md](UPGRADE-HISTORY.md).

1. **Back up:** `setup\8-backup.bat` and check that the new `.dump` file is not empty.
2. **Keep a rollback copy** of the current folder, for example `C:\KUN\kun-mh-before-<version>`.
3. **Stop the app:** `setup\stop-app.bat`.
4. **Copy the new files** with the same settings, keeping `server\.env`, `logs` and `node_modules`:
   ```bat
   robocopy "NEW-PACKAGE\kun-mh" "C:\KUN\kun-mh" /E /XF .env /XD node_modules logs iis archive
   ```
   Robocopy exit codes 0 to 7 mean success.
5. **Packages:** if the package list changed, run `npm ci --omit=dev` in `C:\KUN\kun-mh\server`.
6. **Start the app:** `setup\6-start-app.bat`, and check that the log ends with `KUN MH server running`.
7. **Check:** the health checks (Part 9) and the screens your users need.

**Roll back:** stop the app, copy the rollback folder back (the same `robocopy` with the folders swapped, without `/XF .env`), start the app. Restore the backup only if the data must go back too.

---

## Part 12 - Move the data from PostgreSQL 16 (postgresql-kun-16, port 5433)

Use this once, on a server that still runs KUN MH on its own PostgreSQL 16 cluster. The target is the shared PostgreSQL 18 cluster (step 3). The old cluster stays in place until the new one has run for two weeks.

**Before you start:** plan about an hour, outside working hours. Keep the old cluster running until step 9.

1. **Prepare the new database.** Run steps 1 to 3 (Part 3), so that the role `kunmh` and the database `kun_mh` exist on `postgresql-x64-18`. Do not run step 4 yet.
   1a. **Allow the app to log in, and test it.**
   - a. Add the `pg_hba.conf` line printed by step 3 to `pg_hba.conf` of the shared cluster, above any reject rule.
   - b. Reload the configuration (a reload stops nothing; do not restart the service):
     ```bat
     "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h 127.0.0.1 -p 5432 -U postgres -d postgres -c "SELECT pg_reload_conf();"
     ```
   - c. Test the login of the app role. It must print a row with the value 1:
     ```bat
     "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h 127.0.0.1 -p 5432 -U kunmh -d kun_mh -c "select 1"
     ```
     If it fails, read the message in Part 10 before going on.

2. **Stop the app.** `setup\stop-app.bat`. Tell users to stop saving. Keep the old cluster running.

3. **Save the exact row count of every table** of the old database, as the `postgres` user. The output has one line per table: the table name and its row count.
   ```bat
   "C:\Program Files\PostgreSQL\16\bin\psql.exe" -h 127.0.0.1 -p 5433 -U postgres -d kun_mh -At -F "," -c "SELECT table_name, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint AS row_count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name;" > C:\KUN\backups\counts-pg16.csv
   ```
   Keep the file. It is compared in step 6.

4. **Dump as `postgres`**, with the PostgreSQL 18 programs (the newer client reads the older server):
   ```bat
   "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" -h 127.0.0.1 -p 5433 -U postgres -d kun_mh -Fc -f C:\KUN\backups\kun_mh_pg16_to_18.dump
   ```
   Check the file is not empty.

5. **Restore into the shared cluster.** Ownership and privileges are not copied, and the objects belong to `kunmh`:
   ```bat
   "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" -h 127.0.0.1 -p 5432 -U postgres -d kun_mh --no-owner --no-privileges --role=kunmh -v C:\KUN\backups\kun_mh_pg16_to_18.dump
   ```
   Read the output. Errors about extensions or missing roles must be understood before you go on. To start again, run the same command with `--clean --if-exists` added.

6. **Compare every table.** Save the same count from the new cluster, and compare the two files:
   ```bat
   "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h 127.0.0.1 -p 5432 -U postgres -d kun_mh -At -F "," -c "SELECT table_name, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint AS row_count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name;" > C:\KUN\backups\counts-pg18.csv
   fc C:\KUN\backups\counts-pg16.csv C:\KUN\backups\counts-pg18.csv
   ```
   `fc` must print **FC: no differences encountered**. Any difference: stop. The app stays on the old cluster until the difference is explained.

7. **Point the app at PostgreSQL 18.** Run step 4 (it writes `DB_PORT=5432`, keeps `COOKIE_SECURE`, and saves the old `.env` as `.env.bak`). Then run step 6, check that the log ends with `KUN MH server running`, and run `npm run db:status`: it shows the same tables and counts as step 3.

8. **Spot checks.** Log in. Open a purchase order list, the job card register and the audit log. Compare a few numbers with what users saw before. Then tell users they can save again.

9. **Keep the old cluster for two weeks.** Set the service `postgresql-kun-16` to **Manual** (not Disabled), so it can be started again for a rollback. Keep its data folder. After two weeks of normal use, uninstall PostgreSQL 16 with its uninstaller. If the uninstaller leaves the service behind, stop it, then run as an administrator `sc.exe delete postgresql-kun-16`, and only then delete the data folder. Never change `postgresql-x64-18` or the Billing app during this step.

**Rollback** (before users save on the new cluster): stop the app, restore `server\.env` from `.env.bak` (it has `DB_PORT=5433` and the old password), start the service `postgresql-kun-16`, and start the app.

---

## Part 13 - Copy the hosted (Neon) database to the office server, tables mode

Use this to give the office server a copy of the current hosted database (Neon, production) and run the office app on it in **tables mode**. The hosted site keeps running on Neon.

**Read this first: two live copies.** After this part, the hosted site and the office server each have their own database. Records entered on one do **not** appear on the other, and nothing copies them back. This is by decision (both continue). Choose which copy people use for each kind of work, and write it down. A future copy from Neon would overwrite the office data (step 5 starts with a backup for that reason).

**Do not use this part for the PostgreSQL 16 database** of the office server: that is Part 12. If the office server holds data that is not in Neon, decide first which copy keeps it.

**Before you start**

- Plan about two hours, outside working hours. Office users stop saving during steps 5 to 7. The hosted site is not affected.
- You need the production database URL of Neon. Keep it in your own session only: never paste it into chat, a file, a ticket or the repository. Run every command below in PowerShell, in the `server` folder, with `$env:DATABASE_URL` set in that window only.
- Use the PostgreSQL 18 programs (`C:\Program Files\PostgreSQL\18\bin`) for `pg_dump`, `pg_restore` and `psql`.
- Check that the schema of the office database matches: the app applies `schema.sql` and `schema-tables.sql` itself, so this is handled by the app's start-up (step 6).

1. **Freeze nothing on Neon.** The hosted site continues. Take the dump at a quiet time, and record the time of the dump in the change log: records entered after it will not be in the office copy.

2. **Check the source.** In the Neon console, or with `psql`, check the server version and the table counts:
   ```powershell
   $env:DATABASE_URL = "<NEON PRODUCTION URL>"
   & "C:\Program Files\PostgreSQL\18\bin\psql.exe" "$env:DATABASE_URL" -At -c "SHOW server_version;"
   ```
   The version must be 18 or older. Note the date and time in the change log.

3. **Dump Neon** in the custom format (PostgreSQL 18 `pg_dump` reads the Neon server):
   ```powershell
   & "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" "$env:DATABASE_URL" -Fc --no-owner --no-privileges -f C:\KUN\backups\neon_prod_YYYY-MM-DD_HHMM.dump
   Remove-Item Env:DATABASE_URL
   ```
   Check that the file is not empty, and copy it to a second drive.

4. **Restore into a scratch database first**, and compare every table with Neon. The scratch database is `kun_mh_neon_check`, owned by the superuser, and is removed at the end.
   ```powershell
   $pg = "C:\Program Files\PostgreSQL\18\bin"
   & "$pg\psql.exe" -h 127.0.0.1 -p 5432 -U postgres -d postgres -c "CREATE DATABASE kun_mh_neon_check;"
   & "$pg\pg_restore.exe" -h 127.0.0.1 -p 5432 -U postgres -d kun_mh_neon_check --no-owner --no-privileges -v C:\KUN\backups\neon_prod_YYYY-MM-DD_HHMM.dump
   ```
   Read the restore output. Then save the exact row count of every table, from the scratch copy and from Neon, with the same query (Part 12, step 3). The two files must be identical (`fc`). A difference means the copy is not complete: stop.

   ```powershell
   & "$pg\psql.exe" -h 127.0.0.1 -p 5432 -U postgres -d kun_mh_neon_check -At -F "," -c "SELECT table_name, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint AS row_count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name;" > C:\KUN\backups\counts-scratch.csv
   ```
   Repeat the same query against Neon (with `$env:DATABASE_URL` set in your session, then removed), save it as `counts-neon.csv`, and run `fc C:\KUN\backups\counts-neon.csv C:\KUN\backups\counts-scratch.csv`. It must print **FC: no differences encountered**.

   When the check passes, drop the scratch database: `DROP DATABASE kun_mh_neon_check;`

5. **Back up the office database** (the safety copy for the rollback), and stop the app:
   ```powershell
   & "$pg\pg_dump.exe" -h 127.0.0.1 -p 5432 -U postgres -d kun_mh -Fc -f C:\KUN\backups\kun_mh_before_neon_YYYY-MM-DD_HHMM.dump
   ```
   Check the file is not empty. Then `setup\stop-app.bat`.

6. **Replace the office data with the Neon copy.** `--clean --if-exists` drops the objects of the dump in `kun_mh` before they are restored:
   ```powershell
   & "$pg\pg_restore.exe" -h 127.0.0.1 -p 5432 -U postgres -d kun_mh --clean --if-exists --no-owner --no-privileges --role=kunmh -v C:\KUN\backups\neon_prod_YYYY-MM-DD_HHMM.dump
   ```
   The objects are created as the role `kunmh` (`--role`), which is what the app needs. Read the output. Then compare the counts of `kun_mh` with `counts-neon.csv`, the same way as step 4. They must match.

7. **Point the office app at tables mode.** In `server\.env`:
   ```
   DATA_MODE=tables
   ```
   Keep the other settings (DB_PORT=5432, TZ, COOKIE_SECURE). Then start the app with `setup\6-start-app.bat`, and check that the log shows `KUN MH server running ... (data: tables)`.

8. **Check the screens** from another computer: log in with a Neon account (the accounts of the copy are the Neon accounts, with their passwords); open a purchase order list, the job card register, the bills and the audit log; compare a few numbers with the hosted site. Run `setup\check-events.bat` against the office address.

9. **Tell users which copy to use**, and that log-ins are now the hosted site's accounts. Accounts that existed only on the office server before this step no longer work; create them again with `npm run user -- add` if still needed.

**Rollback** (if the office copy is wrong, before users rely on it):

1. `setup\stop-app.bat`
2. Restore the backup from step 5 with `pg_restore --clean --if-exists` into `kun_mh`, the same way as step 6, but using `kun_mh_before_neon_<date>.dump`.
3. In `server\.env`, set `DATA_MODE=kv` (or remove the line), and start the app.

**Ongoing**

- The nightly backup (`KUN-MH Backup`) keeps backing up the office `kun_mh`. It does not copy anything from Neon.
- Neon is not changed by any step of this part, except that the dump only reads it.
- Keep the Neon dump (step 3) for at least a year, and the office backup from step 5 until the office has run for a week.

---

## Security checklist

- [ ] Only IIS (8080, 8443) answers from the network. Ports 3100 and 5432 are closed to the network (`check-access.bat` shows the status of 5432 as a warning, because it is shared).
- [ ] The firewall allows only the office network for 8080 and 8443, not *Any*.
- [ ] `listen_addresses` of the shared cluster is `localhost` (step 1 checks it).
- [ ] `server\.env` is not shared, e-mailed or copied: it holds the database password.
- [ ] The KUN MH role `kunmh` owns only `kun_mh`; the database is closed to PUBLIC (step 3).
- [ ] The task account `kunapp` is not an administrator and the tasks do not run as SYSTEM.
- [ ] HTTPS is in use (Part 8) and `COOKIE_SECURE=true` is set.
- [ ] Each person has their own account; leavers are disabled promptly.
- [ ] Backups are copied off the server each week. They contain business records, not staff e-mail or phone numbers, but they are still private.
- [ ] Stopping `postgresql-x64-18` is agreed with the owner of the Billing app.

---

## Installation checklist

- [ ] Node.js 22 LTS checked (Part 1a)
- [ ] PostgreSQL 18 service running, port 5432 answers, `listen_addresses` reviewed (Part 1b)
- [ ] URL Rewrite 2.1 and Application Request Routing 3.0 installed (Parts 1c and 1d)
- [ ] Certificate thumbprint noted, or HTTPS planned later (Part 1e)
- [ ] Server name in DNS or known to the office network (Part 1f)
- [ ] Route A: steps 1 to 8 finished, no FAIL lines; `check-access.bat` reviewed. Route B: sections 4.1 to 4.6 done
- [ ] `pg_hba.conf` line added by the administrator and reloaded with `SELECT pg_reload_conf();` (step 3); the service was not restarted for it
- [ ] The app opens from another computer; the first log-in works
- [ ] The nightly backup task exists (`KUN-MH Backup`), and one backup was checked
- [ ] The server's time zone is Baghdad time, and `server\.env` has `TZ=Asia/Baghdad`
- [ ] Data moved from PostgreSQL 16, if the server had one (Part 12)
- [ ] Hosted (Neon) copy taken to the office server, if wanted, and the office app on tables mode (Part 13)
- [ ] The server was restarted once, and the app and database came back by themselves
