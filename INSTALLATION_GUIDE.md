# KUN Maintenance & Housekeeping - Installation Guide

This is the one guide for installing, running and updating KUN MH. It is for **version 2.2.0** of the app (the package folder that contains `setup\`, `server\`, `index.html` and `rules.js`).

KUN MH runs on one Windows Server. Its records are stored in a PostgreSQL 18 database on the same server. **IIS** (the web server built into Windows) receives the requests from other computers on the office network and passes them to the app. Other people open the app in their browser; they do not install anything.

```
Other computers' browsers  ->  IIS on the server (port 8080, or 8443 with HTTPS)
                                  ->  KUN app on the server (127.0.0.1:3100, private)
                                        ->  KUN MH PostgreSQL 18 on the server (port 5434, private)
```

**Ports used by KUN MH**

| Service | Port | Reachable from | Set by |
|---|---|---|---|
| IIS, HTTP (office users) | **8080** | Office network (firewall rule) | Setup step 7, or the manual route (Part 4, section 4.6) |
| IIS, HTTPS (office users) | **8443** | Office network (firewall rule) | Setup step 7 (asked only with a certificate) |
| KUN app (Node) | **3100** | This server only (127.0.0.1). IIS forwards to it | `PORT` in `server\.env` |
| KUN MH PostgreSQL 18 (service `postgresql-kun-18`) | **5434** | This server only (127.0.0.1) | `DB_PORT` in `server\.env` |

**Do not use these ports for KUN MH.** They are used by other applications on this server: **3000** (Billing app), **80** and **443** (Billing IIS site), **5432** (Billing PostgreSQL). The scripts refuse them.

The Billing app's PostgreSQL (service `postgresql-x64-18`, port 5432) is not changed by any KUN MH step.

**Which part to follow**

| You want to | Go to |
|---|---|
| Install a new office server with the set-up scripts (recommended) | Parts 1, 2 and 3, then Parts 5 to 10 |
| Install a new server by hand, with Node as an NSSM service and IIS as a reverse proxy | Parts 1, 2 and 4, then Parts 5 to 10 |
| Update an installed server to version 2.2.0 | Part 11, section 11.4, and Part 11.3 for the 1.9.2 checks |
| Upgrade a server that runs version 1.9 or 1.9.2 | Part 11.2, then Part 11.3 |
| Upgrade a server that is still on a version before 1.9 | Part 11.1, then Part 11.2 |
| Set up or check the hosted site (Vercel), or move its database to tables | Part 12 |

**Before you start**

- You need an administrator account on the server, and the server must be on the office network.
- Use Node.js **22 LTS** (22.9.0 or newer). It is the version known to run well on Windows Server 2016.
- Install the application in a permanent folder such as `C:\KUN\kun-mh`. Do not run it from the Downloads folder, from a network share, or from a folder under `C:\Users\`.
- The package folder holds `setup\`, `server\`, `index.html`, `rules.js` and the other files. The Vercel-only files (`api\`, `vercel.json`) are not used on the office server and can be left out.
- A **new** server gets PostgreSQL 18 as described here. A server that already runs KUN MH on PostgreSQL 16 is not covered by the fresh-install steps. Move its data first with the server's own migration record (kept with the installation records, not in this repository).
- Plan about one hour for a new server.

---

## Part 1 - Prerequisites (once, by hand)

### 1a. Node.js 22 LTS
1. Open **Command Prompt** and run `node -v`. It must show `v22.9.0` or newer.
2. If it does not, install the **22 LTS** version from https://nodejs.org (default options), then open a new Command Prompt.
3. No global npm packages are needed. Do not install PM2.

### 1b. PostgreSQL 18 with the Command Line Tools
1. Install **PostgreSQL 18** with the **Command Line Tools** option, from https://www.postgresql.org/download/windows/. The folder `C:\Program Files\PostgreSQL\18\bin` must then exist.
2. This installation is separate from the Billing app's PostgreSQL. Do **not** change the Billing app's service (`postgresql-x64-18` on the server) or its port 5432.
3. The KUN MH database cluster is created by **step 3** of the scripts (Route A), or by hand in Part 4, section 4.3 (Route B). It uses service `postgresql-kun-18`, port 5434 and data folder `C:\KUN\pgdata-kun18`.
4. Check whether PostgreSQL 18 is supported on your Windows Server version before you install it (the vendor's platform list).

### 1c. URL Rewrite 2.1 (IIS add-on, install by hand)
1. Go to **https://www.iis.net/downloads/microsoft/url-rewrite** and download the x64 installer.
2. Run it with the default options.

### 1d. Application Request Routing 3.0 (IIS add-on, install by hand)
1. Go to **https://www.iis.net/downloads/microsoft/application-request-routing** and download the installer.
2. Install it **after** URL Rewrite, with the default options. Accept the prompts that appear.

IIS itself (the Web Server role) is installed by setup step 7 (Route A), or by hand in Part 4, section 4.6 (Route B).

### 1e. HTTPS certificate (recommended, ask IT)
Users' passwords and records should travel encrypted. A certificate belongs to a **name**, not to an application, so the certificate used for the Billing app can be used for KUN MH too, if it covers the name that KUN MH users will type. Note its **thumbprint**; setup step 7 asks for it. Part 8 explains how to find it.

- **Reuse the Billing certificate** if its names include the KUN MH server name, for example `server.yourcompany.local` or a wildcard such as `*.yourcompany.local`. Both sites can use one certificate: KUN MH uses port 8443 and Billing uses 443.
- **Otherwise** ask IT for a certificate that includes the name KUN MH users will type, or a separate certificate for it.
- A certificate must have its private key on this server and must not expire within 14 days. Setup step 7 checks both.

You can start without a certificate and add one later.

### 1f. Server name (ask IT)
Other computers reach the app by the server's name (for example `kun-mh`) or its IP address. IT should add the name to DNS, or the name must be known on the office network.

### 1g. NSSM (Route B only)
NSSM (the Non-Sucking Service Manager) runs Node as a Windows service. Install it to a fixed folder, for example `C:\Tools\nssm\nssm.exe`, and keep it on the server only. The set-up scripts (Route A) do not use NSSM; they use a scheduled task.

---

## Part 2 - Choose the install route

| | Route A - set-up scripts | Route B - manual, NSSM service |
|---|---|---|
| Who it is for | The usual office server | An administrator who wants each step visible, or a server that cannot run the scripts |
| App runs as | A Windows scheduled task, `KUN-MH Server` | A Windows service, `KUN-MH`, created with NSSM |
| IIS | Set up by step 7 | Set up by hand (section 4.6) |
| Database cluster | Created by step 3 | Created by hand (section 4.3) |
| Same result | Yes: the same folders, the same `server\.env`, the same ports and the same checks in Part 9 | |

Use one route per server. Do not mix them.

---

## Part 3 - Route A: run the set-up scripts

Open the `setup` folder inside `kun-mh`. For each step, **right-click** the `.bat` file and choose **Run as administrator**. Read the window, follow the instructions, then press Enter to close it. Run the steps in order.

| Step | File | What it does |
|---|---|---|
| 1 | `1-check-requirements.bat` | Checks Node.js, the PostgreSQL 18 programs, IIS URL Rewrite and ARR, and that the KUN MH ports are free. Fix anything marked **FAIL** before going on. |
| 2 | `2-install-packages.bat` | Downloads the packages the server needs (`npm ci`). One time only. |
| 3 | `3-create-database.bat` | Creates the KUN MH database cluster (service `postgresql-kun-18`, port 5434, data in `C:\KUN\pgdata-kun18`) if it does not exist, then the database `kun_mh` and the user `kunmh`. |
| 4 | `4-configure.bat` | Saves the settings file `server\.env` (ports, database password) and tests the connection. |
| 5 | `5-create-admin.bat` | Creates the log-in accounts for the people who will use the app. Repeat for each person. |
| 6 | `6-start-app.bat` | Runs the app in the background as a Windows scheduled task. It starts with the server and restarts itself if it stops. |
| 7 | `7-setup-iis.bat` | Installs IIS, connects it to the app, sets the office ports and the firewall, and tests the connection from this server and its network address. |
| 8 | `8-backup.bat` | Saves a copy of the database to `C:\KUN\backups`. Run it weekly. |
| - | `check-access.bat` | Read-only check, run any time: services, ports, IIS, firewall, and what other computers can reach. |

**Notes**

- Steps 1, 7 and `check-access` are safe to repeat.
- Steps 3 and 4 ask you to type passwords. Nothing is shown while you type; that is normal.
- **Step 3** asks you to choose a password for the `postgres` user of the **KUN MH** database. This is not the Billing app's password. Then it asks for a password for the app database user `kunmh`. Write both down.
- **Step 4** writes `server\.env` with the port and database settings only. It does not set `DATA_MODE`, so the office server uses the original document layout (`kv_docs`). Keep it that way unless the database has been migrated first (Part 12, section C).
- **Step 5** asks for an email, a name and a password (at least 8 characters) for each person. Give each person their password **in person**.
- **Step 7** asks these questions:
  1. **Which computers may open the app.** Press Enter for *LocalSubnet* (computers on the same network as the server). Type one or more ranges separated by commas, such as `10.10.0.0/16,10.20.0.0/16`, if the office uses several networks. Ask IT if you are not sure.
  2. **Certificate thumbprint.** Paste it (Part 8), or press Enter to skip HTTPS for now.
  3. **Port for HTTP**, and with a certificate **port for HTTPS**. Press Enter for **8080** and **8443**. Do not choose 80, 443, 3000 or 5432.
  4. **Stop a website on that port?** Only if the step finds another IIS website using it. A website is stopped, not deleted.
- Step 7 also creates the IIS application pool **KUN-MH** (no .NET) and the Windows Firewall rules, and removes old KUN MH rules and bindings from an earlier run.
- After step 7, run `check-access.bat`, then log in with the first account from another computer. The first person to set up the app becomes the owner and chooses **Start with the example data** (for training) or **Start empty** (for real use).

---

## Part 4 - Route B: manual install with NSSM and IIS as a reverse proxy

Use this route when the set-up scripts cannot be used. Placeholders in angle brackets are yours to fill in:

| Placeholder | Meaning | Example |
|---|---|---|
| `<RELEASE>` | The release folder | `C:\KUN\kun-mh` |
| `<PORT>` | The port the app listens on, on 127.0.0.1 only | `3100` |
| `<DB_PORT>` | The PostgreSQL 18 cluster for KUN MH | `5434` |
| `<DATA>` | Folder for logs and reports, outside the release folder | `C:\KUN\data` |
| `<PG_BIN>` | PostgreSQL 18 programs | `C:\Program Files\PostgreSQL\18\bin` |

### 4.1 Release folder and packages

Copy the release, which is a subset of the package:

- **Include:** `index.html`, `rules.js`, and `server\` with its `src`, `client`, `schema.sql`, `schema-tables.sql`, `upgrade-1.9.sql`, `vendor-names-en.json`, `package.json` and `package-lock.json`.
- **Leave out:** `archive\`, `api\`, `vercel.json`, `.vercel\`, `server\test\`, `server\testing\`, `.git\`.

Keep the structure. The server reads `index.html` from the folder above `server\`.

```bat
cd <RELEASE>\server
npm ci --omit=dev
node -e "require('express'); require('pg'); require('bcryptjs'); console.log('packages ok')"
```

- `npm ci` installs exactly the versions in `server\package-lock.json` and removes packages not listed there. `--omit=dev` leaves only what the app needs at run time.
- There is **no build step** and no build output folder. The release folder is `<RELEASE>` itself.
- To prune an existing `node_modules` later, run `npm prune --omit=dev` in `<RELEASE>\server`.

### 4.2 Environment file

Create `<RELEASE>\server\.env` from `server\.env.example`, and fill in the values from Part 5. Restrict the file to the service account and administrators. Node does not read `.env` by itself: the start command in section 4.4 loads it. If you set the variables in NSSM instead, the file can be left out.

### 4.3 PostgreSQL 18 cluster (by hand)

Run these as the account that will own the cluster (not as Administrator), with the PostgreSQL 18 programs from `<PG_BIN>`:

```bat
rem 1. Initialise the data folder. Put the superuser password in a file that is deleted afterwards.
"<PG_BIN>\initdb.exe" -D C:\KUN\pgdata-kun18 -U postgres -A scram-sha-256 -E UTF8 --pwfile=<PASSWORD_FILE>
del <PASSWORD_FILE>

rem 2. Edit C:\KUN\pgdata-kun18\postgresql.conf and set:
rem    port = 5434
rem    listen_addresses = '127.0.0.1'

rem 3. Register and start it as a Windows service
"<PG_BIN>\pg_ctl.exe" register -N postgresql-kun-18 -D C:\KUN\pgdata-kun18 -S auto
net start postgresql-kun-18

rem 4. Check that it listens on 127.0.0.1 only
netstat -an | findstr :5434
```

Create the role and the database (psql, as the superuser):

```bat
"<PG_BIN>\psql.exe" -h 127.0.0.1 -p 5434 -U postgres -c "CREATE USER kunmh WITH PASSWORD '<new kunmh password>';"
"<PG_BIN>\psql.exe" -h 127.0.0.1 -p 5434 -U postgres -c "CREATE DATABASE kun_mh OWNER kunmh;"
```

Use a new password for `kunmh`. The `kun_mh` database needs no extensions: the schema uses `gen_random_uuid()`, which is built into PostgreSQL 13 and later. Do not create `pgcrypto` or `uuid-ossp`.

### 4.4 Start command and the NSSM service

The production start command, run from the server folder, is:

```
node --env-file-if-exists=.env src\server.js
```

Create the service (run as administrator). Replace the placeholders:

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

- Do not use `npm start` for the service. The `start` script runs the same command, but the service should not depend on npm.
- Run the service under a dedicated local account that can read `<RELEASE>` and write `<DATA>\logs`, not as Administrator: `nssm set KUN-MH ObjectName`.
- Create `<DATA>\logs` and `<DATA>\reports` before the first start.
- The `--env-file-if-exists` flag needs Node 22.9 or newer. It does not fail when `.env` is absent.

### 4.5 Check the binding and the health

- `src\server.js` reads `PORT` (default 3100) and `HOST` (default `127.0.0.1`), and calls `app.listen(PORT, HOST)`. With `HOST=127.0.0.1` the app is reachable from this computer only.
- Check the binding: `netstat -an | findstr LISTENING | findstr :<PORT>`. The line must read `127.0.0.1:<PORT>`. A line with `0.0.0.0:<PORT>` or `[::]:<PORT>` means `HOST` is wrong.
- The start-up log line reads `KUN MH server running at http://localhost:<PORT>`.
- Health checks (see Part 9): `GET http://127.0.0.1:<PORT>/` returns 200, and `GET http://127.0.0.1:<PORT>/api/me` with no cookie returns 401 with `"Log in first"`.

### 4.6 IIS as a reverse proxy (ARR)

1. Install the Web Server role with IIS Manager, then URL Rewrite 2.1 and Application Request Routing 3.0 (Parts 1c and 1d).
2. In IIS Manager, select the server, open **Application Request Routing Cache**, then **Server Proxy Settings**. Tick **Enable proxy**. Set the timeout to more than 25 seconds (live updates keep a connection open; see Part 9).
3. Create a site called `KUN-MH` with a physical path to an empty folder, for example `C:\KUN\iis`, and a binding of **http** on port **8080** (or your choice; not 80, 443, 3000 or 5432). Use its own application pool, `KUN-MH`, with **No Managed Code**.
4. In the site, add a URL Rewrite **reverse proxy** rule that forwards everything to `http://127.0.0.1:<PORT>/{R:0}`. Turn off response buffering for `/api/events` (the live-update stream). Setup step 7 writes the equivalent `web.config` for you.
5. Open the firewall for the chosen port only, from the office network: a rule named `KUN-MH IIS port 8080`, inbound, TCP, allowed for the network profiles in use.
6. For HTTPS (optional), bind port 8443 with the certificate (Part 8), and set `COOKIE_SECURE=true` once it works.
7. Test from another computer: `http://<SERVER-NAME>:8080/` shows the log-in page.

---

## Part 5 - Configuration reference (`server\.env`)

The app reads its settings from the environment. Both routes use the same settings. A value marked **secret** must never be shared, e-mailed, or put in the repository.

| Variable | Required | Secret | Default | Example | Notes |
|---|---|---|---|---|---|
| `PORT` | yes | no | `3100` | `3100` | Port for the app. IIS forwards to it. Do not use 3000 (another application) |
| `HOST` | yes | no | `127.0.0.1` | `127.0.0.1` | Keep `127.0.0.1`. Other values expose the app without IIS |
| `DB_HOST` | yes, unless `DATABASE_URL` is set | no | `127.0.0.1` | `127.0.0.1` | PostgreSQL on this machine |
| `DB_PORT` | yes, unless `DATABASE_URL` is set | no | `5433` | `5434` | The port of the KUN MH PostgreSQL 18 cluster. The default in code is an old value; set it to `5434` |
| `DB_NAME` | yes, unless `DATABASE_URL` is set | no | `kun_mh` | `kun_mh` | |
| `DB_USER` | yes, unless `DATABASE_URL` is set | no | `kunmh` | `kunmh` | |
| `DB_PASSWORD` | yes, unless `DATABASE_URL` is set | **yes** | empty | `<secret>` | Password of `DB_USER` |
| `DATABASE_URL` | no | **yes** | not set | `postgres://USER:PASSWORD@127.0.0.1:5434/kun_mh` | Full connection string. If set, it overrides all `DB_*` values (used for the hosted site) |
| `DB_SSL` | no | no | off | `require` | Turns on TLS. Not needed on localhost; needed for Neon |
| `DB_POOL_MAX` | no | no | `10` | `10` | Connections per server process |
| `DATA_MODE` | no | no | `kv` | `kv` | `kv` keeps documents in `kv_docs` (office server). `tables` uses the relational tables (hosted site after cutover, Part 12) |
| `COOKIE_SECURE` | no | no | off | `true` | Marks the session cookie `Secure`. Set it only when users reach the app over HTTPS |
| `LIVE_UPDATES` | no | no | on | `on` | Set `off` to disable the database listener for live updates |

Settings read only by the one-time database set-up (`src\create-database.js`), not by the running service: `PG_PORT`, `PG_SUPERUSER_PASSWORD`, `KUNMH_PASSWORD`. The `KUN_*` variables are read only by the `setup\` scripts.

Example `.env` (placeholders only):

```
PORT=3100
HOST=127.0.0.1
DB_HOST=127.0.0.1
DB_PORT=5434
DB_NAME=kun_mh
DB_USER=kunmh
DB_PASSWORD=<secret>
COOKIE_SECURE=true
```

---

## Part 6 - Database

- **Engine:** PostgreSQL 18, own cluster for KUN MH (Part 1b, and section 4.3 or step 3).
- **Schema:** `schema.sql` is applied automatically every time the server starts. It only creates tables that do not exist, so it is safe to run again. `schema-tables.sql` is used only by the copy command `npm run migrate:tables` (Part 12). Do not run it by hand.
- **Extensions:** none (Part 4.3).
- **Seed data:** none. The application starts empty, except for the example data you may choose in the first log-in (step 7 in Part 3). Create the first log-in on Route B with:

  ```bat
  cd <RELEASE>\server
  npm run user -- add <EMAIL> "<Full name>" "<password of 8 or more>"
  ```

- **Masters** (items, vendors, users, budget) are loaded from a file: `npm run masters:import -- <FILE> --dry-run`, then without `--dry-run`. The file contains staff details; keep it out of the release folder.
- **Account commands:** `npm run user -- list | add | password | disable | enable`.

---

## Part 7 - Everyday use (on the server)

| Task | Route A (scripts) | Route B (NSSM) |
|---|---|---|
| Start the app | Double-click `setup\6-start-app.bat` (it starts the scheduled task **KUN-MH Server**). Normally it starts by itself after a restart | `nssm start KUN-MH` |
| Stop the app | Double-click `setup\stop-app.bat`. Users then see an error page until the app is started again | `nssm stop KUN-MH` |
| Restart the app | `stop-app.bat`, then `6-start-app.bat` | `nssm restart KUN-MH` |
| Check the app's log | Open `kun-mh\logs\server.log` in Notepad. The newest lines are at the bottom | Open `<DATA>\logs\server.log` |
| Start or stop the KUN MH database | **services.msc** > **postgresql-kun-18** (not the Billing service **postgresql-x64-18**) | Same |
| Check access | Double-click `setup\check-access.bat` | Run the health checks in Part 9 |
| Back up | Double-click `setup\8-backup.bat` (weekly). The backup is saved in `C:\KUN\backups` | `pg_dump` into `<DATA>\backups` (commands in `server\README.md`, Backups) |
| Restore a backup | In the app: **Admin > Data > Restore from backup**. Type `RESTORE` to confirm; the dialog shows how many records it replaces | Same |
| Reset to example data | In the app: **Admin > Data > Reset to example data**. Type `RESET` to confirm. Do not use on the live system | Same |
| Add a person | Double-click `setup\5-create-admin.bat` | `npm run user -- add ...` (Part 6) |
| Change a password or block a leaver | `npm run user -- password EMAIL "NEW-PASSWORD"` or `npm run user -- disable EMAIL`, in the `server` folder | Same |
| Change who may open the app, or the ports | Re-run `setup\7-setup-iis.bat` and answer the questions again | Edit the IIS rule and the firewall rule (section 4.6) |
| Restart IIS | Command Prompt as administrator: `iisreset` | Same |

Copy the backup files to another drive or server as well. A backup on the same disk does not protect against a disk failure.

---

## Part 8 - Use from other computers, and HTTPS

**Address.** Tell the users the address, for example `http://kun-mh:8080/` or `http://10.10.1.25:8080/` (the server's name or IP address, and the port in use; 8080 by default).

**Test it once from another computer (on the office network)**

1. Open a browser and go to the address. The log-in page must appear.
2. Log in with an account you created.
3. If HTTPS is set up, open `https://kun-mh:8443/` and check that the padlock shows and the certificate name matches.

**If other computers cannot open it**

- Run `check-access.bat` on the server (Route A). It shows which check fails and what to do.
- Check that the other computer is on the network allowed by the firewall rule. Re-run step 7 if the office network is wider (Route A).
- Use the IP address instead of the name if the name does not work. The name only works when the network knows it (ask IT to add it to DNS).
- Check the Windows Firewall rules **KUN-MH IIS port 8080** (and 8443) in *Windows Firewall with Advanced Security*.
- Check that the server's network profile is *Private* or *Domain* if the firewall rules do not seem to apply.

**What must stay closed.** Only IIS (8080 and 8443) is reachable from the network. Ports **3100** (the app) and **5434** (the database) must not answer from other computers.

**HTTPS (certificate)**

With HTTPS, the browser shows a padlock and the log-in is encrypted.

1. Ask IT for a certificate for the server's name, installed in **Local Computer > Personal**. A certificate from the company certificate authority is best.
2. Find the thumbprint: press Win+R, type `certlm.msc`, open **Personal > Certificates**, double-click the certificate, open the **Details** tab, select **Thumbprint**, and copy the value. Remove the spaces when you paste it.
3. Route A: run `setup\7-setup-iis.bat` again and paste the thumbprint. It opens the HTTPS port (8443 by default) and redirects http:// to https://SERVER-NAME:8443/. Route B: bind the certificate to port 8443 on the KUN-MH site in IIS Manager.
4. Once HTTPS works, set `COOKIE_SECURE=true` in `server\.env` and restart the app (Part 11.3, step 5).

A self-signed certificate makes each browser show a warning until it is trusted on every computer. Use a company certificate where possible.

---

## Part 9 - Runtime notes and checks

**Health checks**

| Check | Request | Expected |
|---|---|---|
| Process is up | `GET http://127.0.0.1:<PORT>/` | HTTP 200, the HTML of the app |
| App and session handling | `GET http://127.0.0.1:<PORT>/api/me` with no cookie | HTTP 401, JSON with `"error":"Log in first"` |
| Database | `npm run db:status` in the `server` folder | Database name, tables and record counts; no secrets printed |

A 502 from IIS means the proxy cannot reach the app: the service is stopped or not listening on `<PORT>`. There is no dedicated health route in the app.

**Writable folders.** The running app writes nothing inside the release folder. Keep the release read-only for the service account. Logs go to `<DATA>\logs` (Route B) or `kun-mh\logs` (Route A). Reports from the migration commands go where `--report` points, outside the release. Backups are downloaded by the browser (Admin > Data) or written by `8-backup.bat` / `pg_dump`. There are no uploads: the Excel import reads the file in the browser.

**Live updates.** The browser opens `GET /api/events` (server-sent events), which sends a comment line every 25 seconds. Changes are passed between processes through PostgreSQL `LISTEN`/`NOTIFY`, on one dedicated connection that reconnects if it drops. IIS must not buffer this stream, and its forwarding timeout must be longer than 25 seconds (section 4.6). Set `LIVE_UPDATES=off` to turn it off; users then see changes after reloading.

**Request size and timeouts.** JSON bodies up to 10 MB. Database connection attempts time out after 10 seconds and single queries after 20 seconds. Node's default HTTP request timeout applies to ordinary requests.

**Frontend.** There is no separate frontend build. `index.html` is one page: the server reads it and serves it at `/`, adds the browser adapter `server\client\server-adapter.js`, and serves `rules.js` at `/rules.js`. The page calls the server with relative paths (`/api/...`), so there is no API base URL to set.

**Scheduled jobs and single instance.**
- Inside the app: one job, every hour, deletes expired sessions. It is safe to run in more than one process.
- The login lock-out (three wrong passwords, 30 seconds) is kept in each process's memory. Run **one** instance of the service.
- No cron job or Windows task is needed for the app. Backups are a separate weekly task (`setup\8-backup.bat`).
- These must run once, by hand, never from the service: `npm run migrate:tables`, `npm run migrate:kv`, `upgrade-1.9.sql` (old installs), `npm run masters:import`, and the one-time corrections `npm run vendors:avl`, `budget:merge`, `roles:fix-1.9`, `vendors:english`.

---

## Part 10 - Troubleshooting

| Message or symptom | What to do |
|---|---|
| `Node.js is not installed` (step 1) or `too old` | Install Node.js 22 LTS (Part 1a), open a new window, run step 1 again |
| `URL Rewrite is not installed` / `Application Request Routing is not installed` (step 1 or 7) | Install them as in Parts 1c and 1d, then run step 1 or 7 again |
| `The PostgreSQL 18 programs were not found` (step 3) | Install PostgreSQL 18 with the Command Line Tools (Part 1b) |
| `Port 5434 is used by another database` (step 3) | Another program uses 5434. Choose another free port with `KUN_PG_PORT` and never 5432 |
| `The service postgresql-kun-18 did not start` (step 3) | Grant the account `COMPUTERNAME\kunpg` the right *Log on as a service* in `secpol.msc`, then run step 3 again |
| `The database files could not be created` (step 3) | Delete the folder `C:\KUN\pgdata-kun18` and run step 3 again |
| `PostgreSQL is not running on port 5434` (step 1, 3 or 4) | Start the service **postgresql-kun-18** in services.msc |
| `could not connect` / `password authentication failed for user "kunmh"` | The `DB_PASSWORD` in `server\.env` does not match user `kunmh`. Run step 4 again with the right password |
| `database "kun_mh" does not exist` | Run step 3 (Route A), or create it as in Part 4.3 (Route B) |
| `The KUN MH database cannot use port 5432` (step 1, 3 or 4) | 5432 is the Billing app's database. Use 5434 |
| `The app port and the PostgreSQL port must be different` (step 4) | Choose different ports for the app (3100) and the database (5434) |
| `Port 8080 is already in use by another program` (step 7) | Choose another port in step 7 (not 80, 443, 3000 or 5432) |
| `Port 8080 is in use by the IIS website 'Default Web Site'` (step 7) | Answer *y* to stop that website, or choose another port |
| `The app did not start yet` (step 6) | Read the log lines shown. The usual cause is that the database service is stopped, or the `kunmh` password in `server\.env` is wrong |
| `Port 3100 is already in use` (step 6) | The app is probably running already. Use `stop-app.bat` (Route A) or `nssm stop KUN-MH` (Route B) first |
| `IIS answered with status 502` or `500` (step 7 or check-access) | The app is not running. Start it, then check the log |
| `No certificate with thumbprint` (step 7) | Check the thumbprint and that the certificate is in Local Computer > Personal |
| Users see *Loading the shared data* | Reload the page. Check the log for an error |
| Users see *502 Bad Gateway* or an IIS error page | The app is stopped. Start it |
| `pg_dump.exe was not found` (step 8) | Install PostgreSQL 18 with the Command Line Tools, or back up from the app: **Admin > Data > Download backup** |
| *Wrong email or password* in the app | Check the spelling. An administrator can reset the password (Part 7) |
| *Your role may not change this page* (a save is refused) | The person's role cannot edit that page. Check **Admin > Access rights**; the Head of Accounts can change it (Part 11.3) |
| A page shows no records, or *Nothing here yet* where records are expected | The role cannot see the pages that use those records. Check **Admin > Access rights** |
| `Live-update connection lost, reconnecting` in the log | The app keeps retrying the database connection. If it stays, check that PostgreSQL is running (service `postgresql-kun-18`) and restart the app |
| `Type RESET exactly to confirm` / `Type RESTORE exactly to confirm` | The confirmation word was not typed exactly (capitals). Nothing was reset or restored |
| `The app is in a user profile folder` (step 7) | IIS cannot read the app there. Move the folder to `C:\KUN\kun-mh` (Part 11.1, step 1c), then run `6-start-app.bat` and `7-setup-iis.bat` from the new folder |
| Settings show blank job targets, or the job-card priority list still shows *Urgent* | The 1.9 data upgrade has not run. Run Part 11.1, step 4 |
| `psql.exe was not found` (Part 11.1, step 4) | Install PostgreSQL 18 with the Command Line Tools (Part 1b), then run Part 11.1, step 4 again |
| `Could not connect to the database` during the data upgrade | Check that the service `postgresql-kun-18` is running and that the `kunmh` password is right |

When you report a problem, send the text from the script window (Route A), the output of `check-access.bat`, and the last lines of the log.

---

## Part 11 - Updates and upgrades

Every update follows the same steps. Use the section for the version you are coming from.

**General update procedure**

1. Back up the database (`setup\8-backup.bat`, or `pg_dump`). Check the file is not empty.
2. Keep a copy of the current app folder as the rollback copy, for example `C:\KUN\kun-mh-before-<version>`.
3. Stop the app (`setup\stop-app.bat`, or `nssm stop KUN-MH`).
4. Copy the new files over the installed folder, keeping `server\.env`, logs and `node_modules`:
   ```bat
   robocopy "NEW-PACKAGE\kun-mh" "C:\KUN\kun-mh" /E /XF .env /XD node_modules logs iis archive
   ```
   Robocopy exit codes 0 to 7 mean success; 8 or more means an error.
5. Route B only: run `npm ci --omit=dev` in `C:\KUN\kun-mh\server` if the packages changed.
6. Start the app, and check that the log ends with `KUN MH server running`.
7. Check the screens and the health checks (Part 9).

**Rollback:** stop the app, copy the rollback folder back over the installed folder (the same `robocopy` with the two folders swapped, and without `/XF .env`), start the app. If the data must be undone too, restore the backup from step 1 (**Admin > Data > Restore from backup**).

### 11.1 Upgrade a server older than version 1.9

Use this when KUN MH is running on a server that was installed before version 1.9. The database, the log-ins and the transactions (POs, GRNs, bills, job cards, payments, audit log) stay as they are. Master data is replaced with the 1.9 masters.

**What changes in version 1.9**

| Part | Change | How it is applied |
|---|---|---|
| Screens (`index.html`) | New screens **Consolidated cash PV** (MH-16B) and **Notifications and pending actions**. Job-card priorities are *High* and *Normal* only, with targets in days. Bills above the bill tolerance need variance approval. The default payment mode for new POs is *Cash* | Copy the new files (step 3) |
| Database layout (`schema.sql`) | **No change** | Nothing to do |
| Server code (`server\src`, `server\client`) | Two new commands for master data (`masters:export`, `masters:import`) | Copy the new files (step 3) |
| Settings and priority list | New settings keys, job-card targets in days, *Urgent* removed | `server\upgrade-1.9.sql` (step 4) |
| Job cards with priority *Urgent* | Become **High**. Any that should be *Normal* are changed in the app afterwards | `upgrade-1.9.sql` (step 4) |
| Master data: items, vendors, users, price list (MPL), budget lines, categories, lists, access rights, settings | Replaced with the 1.9 masters, from `KUN-MH-masters-1.9.json` | Import (step 5) |

The master-data import keeps the settings (approval passphrase, lock state, occupancy plan), the password fields of users, every transaction, the room status, the number log and the audit log. Rooms (`m_rooms`) are not part of the master import.

**Before you start**

- Note the folder the app runs from. It must be `C:\KUN\kun-mh`, not a folder under `C:\Users\`. If it is under `C:\Users\`, do step 1c first.
- Make sure `psql.exe` is installed (Part 1b). You need the password of the database user `kunmh` (Part 3, step 3).
- Get `KUN-MH-masters-1.9.json` from the office. It contains staff names and contact details: keep it on the server only, and do not e-mail it.
- Plan about 30 minutes, outside working hours.

**Steps**

1. **Back up.**
   a. Run `setup\8-backup.bat` and check that the new file in `C:\KUN\backups` is not empty.
   b. Copy the whole `kun-mh` folder to `C:\KUN\kun-mh-before-1.9`. This is the rollback copy.
   c. If the app is under `C:\Users\`, copy the folder to `C:\KUN\kun-mh` and run the remaining steps from there. Then run `6-start-app.bat` and `7-setup-iis.bat` once from the new folder.
2. **Stop the app.** Double-click `setup\stop-app.bat`.
3. **Copy the new files** with the `robocopy` command in the general procedure (replace `NEW-PACKAGE`).
4. **Upgrade the settings and priorities.** In a Command Prompt, in the `server` folder of the installed app:
   ```bat
   cd C:\KUN\kun-mh\server
   "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h 127.0.0.1 -p 5434 -U kunmh -d kun_mh -f upgrade-1.9.sql
   ```
   Type the `kunmh` password when asked. The script prints the settings `job_high_days` 1 and `job_normal_days` 2 (or the values derived from the old targets), `cpv_max` 5000000, `bill_tol` 0.1; `priorities` `["High", "Normal"]`; and no rows at the end, which means no *Urgent* job card is left. The script is one transaction and can be run again without harm.
5. **Load the master data.** Copy `KUN-MH-masters-1.9.json` to `C:\KUN\masters\`. In the `server` folder:
   ```bat
   npm run masters:import -- C:\KUN\masters\KUN-MH-masters-1.9.json --dry-run
   npm run masters:import -- C:\KUN\masters\KUN-MH-masters-1.9.json
   ```
   The dry run lists each master document as *new*, *changed* or *unchanged*, and saves nothing. Check it with the Head of Accounts before the real import. The last line of the real import says *Master data saved*.
5a. **Fix the roles.** The 1.9 master file gives the Sigat members and the Internal Auditors the role Admin. Run `setup\9-fix-roles-1.9.bat` as administrator, with the app stopped. It shows the four changes (SIGAT1 and SIGAT2 to *Sigat*, TZAKI and TGHADIALI to *Internal Auditor*) and saves them only when you type `Y`. Each change is recorded in the audit log.
6. **Start the app.** `setup\6-start-app.bat`, then check that the log ends with `KUN MH server running`.
7. **Check the screens.** The menu has **Consolidated cash PV** and **Notifications**; **Settings**, section C, shows *Target - High priority (days)* and *Target - Normal priority (days)*; the job-card priority list shows *High* and *Normal* only; the masters show the 1.9 values; existing POs, GRNs, bills and job cards still show their numbers and dates.
8. **Check the log-ins.** For each person who needs to sign in, check that an account exists: `npm run user -- list`. Add missing ones with `setup\5-create-admin.bat`.
9. **Review the Urgent job cards.** Former *Urgent* job cards are now *High*. Open any that should be *Normal* and change the priority in the app.
10. **Review the settings** with the Head of Accounts (Settings, sections B and C).

**Upgrade checklist (1.9)**

- [ ] Backup made in `C:\KUN\backups`, and the rollback folder copied
- [ ] App folder is not under `C:\Users\`
- [ ] App stopped, new files copied with `robocopy`, `server\.env` kept
- [ ] `upgrade-1.9.sql` ran without errors and printed the expected values
- [ ] Master-data dry run reviewed, then the import saved
- [ ] App started, and the log shows the server running
- [ ] Masters checked on the screens; existing transactions unchanged
- [ ] Log-ins checked for each person (step 8)
- [ ] Former *Urgent* job cards reviewed (step 9); settings reviewed (step 10)

### 11.2 Apply the 1.9 update changes (for servers on 1.9)

Use this on an installation that runs version 1.9 (section 11.1). The database layout does not change and no packages are added.

**What changes**

| Area | Change | How it is applied |
|---|---|---|
| Screens (`index.html`) | **My desk** home page; **Items & MPL rates** (the MPL is on the Items page); **Log out** button in the header (server mode); GRN **No PO** option; typed items on PO lines, with new items added to the item master | Copy the file (step 2) |
| Server (`server\src\server.js`) | Sign-in locked for 30 seconds after three wrong passwords; Admin can set a temporary log-in password for a linked user; users can change their own password; each change is recorded in the audit log | Copy the file, then restart the app |
| Users (`index.html`) | **My account** button in the header: shows the person's details, changes their own password, and signs out | Copy the file (step 2) |
| Access rights (`index.html`) | Table **Who may create records**: which roles may create purchase orders, GRNs, bills, issue slips, job cards, laundry hand-overs and consolidated PVs. Admin always may | Copy the file. Existing rights are kept |
| Notifications (`index.html`) | **Copy for e-mail** and an **E-mail** link on each pending notice | Copy the file (step 2) |
| Roles | Sigat members and Internal Auditors set to their own role | Section 11.1, step 5a (once) |
| Vendor names | The 58 vendors whose names were in Arabic are now in English, with every saved reference changed | `setup\10-vendor-names-english.bat` (step 4a, once) |
| Budget codes | MT-01 to MT-05, HK-01 and HK-02 become one line **MT**; new line **SR**; the HK item codes become ITM codes | `setup\11-budget-merge-1.9.bat` (step 4b, once) |

No data needs converting. The new access rights default to the existing page rights. Existing GRNs and POs are not changed. The sign-in lock-out is held in the server's memory and clears when the app restarts. Tell users to save their work and log out first.

**Steps**

1. **Stop the app** (`setup\stop-app.bat`).
2. **Copy the new files** with the `robocopy` command in the general procedure. Check that `index.html` and `server\src\server.js` have the date of the new package.
3. **Packages.** Nothing new is installed. If you are unsure, run `npm install` once in `C:\KUN\kun-mh\server`.
4a. **Vendor names (once).** Run `setup\10-vendor-names-english.bat` as administrator, with the app stopped. It shows the 58 renames first and saves them only when you type `Y`, after writing a backup. Names marked (2) may be duplicates of existing vendors; merge them in Vendors if they are the same vendor. Skip this step if the names are already in English.
4b. **Budget codes and item codes (once).** Run `setup\11-budget-merge-1.9.bat` as administrator, with the app stopped. It shows the change first and saves it only when you type `Y`, after writing a backup. If it reports that the old budget lines were not found, the change is already made: skip it.
5. **Start the app**, and check that the log ends with `KUN MH server running`.
6. **Roles (once).** If the Sigat members and Internal Auditors still show the role Admin, run `setup\9-fix-roles-1.9.bat` as administrator and type `Y` when asked.
7. **Check the screens.** The menu has **My desk** and **Items & MPL rates**; the header shows **My account** and **Log out**; each pending notice on **Notifications** has **Copy for e-mail**; **Access rights** shows **Who may create records**; the item lines on **Purchase orders** accept a typed item name; the PO dropdown on **Goods receipt notes** has **No PO**.
8. **Check the password tools.** As the Head of Accounts, open a linked user from **Users**: the dialog shows **Reset log-in password**. Do not reset a real user's password as a test.

**Local server checklist (1.9 update)**

- [ ] Backup made; users told to save and log out
- [ ] App stopped, new files copied, `server\.env` kept
- [ ] App started, and the log shows the server running
- [ ] Screens checked (step 7)
- [ ] Roles checked, or step 6 run; vendor names (step 4a) and budget codes (step 4b) checked

### 11.3 Apply the version 1.9.2 changes (access, live updates, backups)

Use this on an installation that runs version 1.9 with the changes of section 11.2. The database layout does not change and no packages are added. A restart is needed, and the access rules take effect as soon as the new files run.

**What changes**

| Area | Change | Who notices |
|---|---|---|
| Access, reads (`server\src\permissions.js`, `server\src\app.js`) | A person now sees only the records of the pages their role can see (Admin > Access rights). Records of pages the role cannot see come back empty. Items, settings and lists, the user list, rooms and the logs stay visible to everyone | Every user. Check the roles before the update |
| Access, writes | A save to a page the role cannot edit is refused with *Your role may not change this page* | Every user who edits records |
| Live updates (`server\src\server.js`) | Changes are sent through the database (PostgreSQL `LISTEN`/`NOTIFY`) | Nobody |
| Backups (**Admin > Data**) | The backup file keeps the business records and leaves out staff e-mail and phone numbers. Each backup is recorded in the audit log | Admin |
| Restore and reset (**Admin > Data**) | Type `RESTORE` or `RESET` to confirm. The dialog shows how many records it replaces | Admin |
| Phone and tablet screens | The Import page fits a 390-pixel screen | Users on phones |
| Calculation rules (`rules.js`) | Approval limits, bill tolerance, cash PV limit and advance status are kept in one file, checked by automatic tests | Nobody (same results) |
| Testing (`server\test\`, `npm test`) | Automatic tests. The local test server (`server\testing\`) is for trying screens only and must not run on the live server | Developers only |

**Before you start**

- **Check the roles.** In **Admin > Access rights**, check every role against the pages it uses. The Head of Accounts must agree the table before users are told about the change.
- Make a backup, and tell users to save their work and log out.

**Steps**

1. **Stop the app.**
2. **Back up** (`setup\8-backup.bat`) and check the file is not empty.
3. **Copy the new files** with the `robocopy` command in the general procedure. The new files are `rules.js`, `server\src\permissions.js` and `server\testing`.
4. **Packages.** No `npm install` is needed. The only change to `server\package.json` is a `test` script.
5. **Turn on the secure cookie (once HTTPS works).** Only after HTTPS works (Part 8), add the line `COOKIE_SECURE=true` to `server\.env`. Without HTTPS, leave it out, or users cannot sign in. Note that setup step 4 (`4-configure.bat`) writes `server\.env` again and keeps the old copy as `server\.env.bak`; if you run it later, add the line again.
6. **Start the app.** Check that the log ends with `KUN MH server running`, and does not show `Live-update connection failed`.
7. **Check the screens.** As the Head of Accounts: **Admin > Data** asks for `RESTORE` and `RESET` and shows a record count; a backup file has no staff e-mail addresses, and near its end a line `"backupNote"` says that staff contact details are not included; the page rights table shows the agreed roles. Then sign in as a GRN Officer, a Maintenance Masool and an Accounts user, and check that their pages show their records and that a page they cannot edit refuses a save.
8. **Check the phone layout (optional).** On a phone, open the Import page and one register. Nothing should scroll sideways.

**Rollback:** copy the files back from the rollback folder (without `/XF .env`), remove `COOKIE_SECURE=true` from `server\.env`, start the app.

**Checklist (1.9.2)**

- [ ] Backup made; access rights checked by the Head of Accounts for every role in use
- [ ] App stopped, new files copied, `server\.env` kept; app started and the log shows the server running
- [ ] Screens checked (step 7), including a backup file with no staff e-mail
- [ ] `COOKIE_SECURE=true` set, only if HTTPS works (step 5)

### 11.4 Version 2.2.0 changes

**What changes for the office server**

| Area | Change |
|---|---|
| Goods receipt notes | A **No PO** receipt is refused when its value, at the master-price-list rates, is at or above the PO limit (500,000 IQD by default). The screen shows the reason. Below the limit it is accepted |
| Bill entry | A bill is either **PO based** (choose the PO) or **No PO based** (choose a GRN that has no PO and is not yet billed). The vendor, the items and the budget line fill in from the GRN |
| Calculation rules (`rules.js`) | The thresholds and the document-type rule are in one file, used by the page and by the tests |
| Server code (`server\src`) | Access checks for documents, the data-mode switch (`DATA_MODE`) and the copy commands. With `DATA_MODE` not set, the office server works exactly as before |
| Installation | Fresh installs use PostgreSQL 18 (Parts 1 to 4). The set-up scripts default to service `postgresql-kun-18`, port 5434 and data folder `C:\KUN\pgdata-kun18` |

The database layout does not change in kv mode. Nothing needs migrating for the office server.

**Steps**

1. **Stop the app.**
2. **Back up** (`setup\8-backup.bat`) and check the file is not empty.
3. **Copy the new files** with the `robocopy` command in the general procedure. The `archive` folder is not needed on the server, and is excluded by the command above.
4. **Check the settings file.** `server\.env` must not set `DATA_MODE=tables` unless the office server's database has been migrated. If the line is missing, the default (`kv`) applies.
5. **Start the app**, and check the log ends with `KUN MH server running`.
6. **Check the screens.** On **Goods receipt notes**, a **No PO** receipt of goods worth at or above the PO limit is refused with the message *at or above the PO limit*, and one below the limit is accepted. On **Bills**, a new bill offers *PO based bill entry* and *No PO based bill entry*; choosing the second shows the GRNs with no PO that are not yet billed, and choosing one fills in the vendor, the items and the budget line.

**Rollback:** as in the general procedure.

---

## Part 12 - Hosted site (Vercel) and the database cutover

The hosted site is this folder deployed to Vercel. `api\index.js` runs the same Express app as the office server, against a Neon PostgreSQL database. Vercel shows the site over HTTPS. The office server and the hosted site are separate installations.

### A. Deploy

- Production: from this folder, `vercel --prod --yes`.
- Preview (for testing a change first): `vercel --yes`. Preview deployments are protected by Vercel Deployment Protection.
- Check the deployment: the command prints the URL and *ready*. Open it, log in, and check one list.

**Environment settings** (set in the Vercel project, in the dashboard or with `vercel env`). Never write a value into the repository, a README or an e-mail:

| Name | Production | Preview | Meaning |
|---|---|---|---|
| `DATABASE_URL` | the production Neon database | a separate test database | Connection string (secret) |
| `DB_SSL` | `require` | `require` | TLS for Neon |
| `COOKIE_SECURE` | `true` | `true` | Session cookie only over HTTPS |
| `DATA_MODE` | `tables` after the cutover in section C (`kv` before) | the same as production, or `kv` for a test | Which data layout the app uses |

Keep the preview `DATABASE_URL` pointing at a database that is not production.

**Roll back a bad release:** `vercel rollback` (or the previous deployment in the Vercel dashboard). This restores the code only, not the data.

### B. Hosted database: kv or tables

The hosted database can run in `kv` mode (documents in `kv_docs`, the original layout) or `tables` mode (relational tables). The office server stays in `kv` mode unless its `server\.env` sets `DATA_MODE=tables`. Tables mode is switched on for the hosted site only once the steps in section C are done. Run every command in the `server` folder, in PowerShell, with the production URL set only in your own session. Do not paste it into chat, a file or a ticket.

### C. Cutover to tables

**Before the cutover**

1. **Restore point.** In the Neon console, create a branch of the production database, named for the date. Or run `pg_dump -Fc` against the production URL and keep the file somewhere safe.
2. **Freeze writes.** Tell users to stop saving until you say so. Keep the freeze until step 6 is complete.

**Cutover**

3. **Dry run against production** (nothing is written):
   ```powershell
   $env:DATABASE_URL = "<PRODUCTION DATABASE URL>"
   $env:DB_SSL = "require"
   node src/migrate-to-tables.js --report cutover-dry-run.json
   ```
   Check that the `Target:` line shows the production host and database, and that the status is `dry run passed`. Stop if it does not.
4. **Apply.** Use the target name printed in step 3:
   ```powershell
   node src/migrate-to-tables.js --apply --confirm-target <HOST/DB> --report cutover-apply.json
   ```
   The status must be `applied and committed`. If it says `FAILED, rolled back`, nothing changed; do not go on.
5. **Check the record.** The `migration_runs` table has a new row with `mode = apply` and `status = applied`.
6. **Switch the app.** In Vercel, set `DATA_MODE=tables` for Production, then run `vercel --prod --yes` from this folder.
7. **Check, then end the freeze.** Log in, open a purchase order list and the job card register, and compare a few numbers with what users saw before. Then tell users they can save again.

**Rollback**

- **Before step 6:** users are still on the old layout. Fix the problem and run the dry run again.
- **After step 6:** set `DATA_MODE=kv` for Production and redeploy. Records saved while the site ran in tables mode are not in `kv_docs`, so first copy the tables back with `node src/migrate-tables-to-kv.js` (dry run), and then with `--apply --confirm-target <HOST/DB>`. The copy keeps a backup of `kv_docs` in a table named `kv_docs_backup_<time>`.
- **Last resort:** restore the restore point from step 1.

**Warning.** The copy back to `kv_docs` (`migrate:kv`) has been dry-run tested against the preview database, but its apply step has not yet been rehearsed on a copy of the database. Rehearse it on a copy before you rely on it for a rollback.

---

## Security checklist

- [ ] Only IIS (ports 8080 and 8443) is reachable from the network. Ports 3100 and 5434 are closed to the network (`check-access.bat` confirms, or the checks in Part 8).
- [ ] The firewall rules allow only the office network, not *Any*.
- [ ] HTTPS is in use (Part 8), with a certificate from the company certificate authority, and `COOKIE_SECURE=true` is set.
- [ ] The KUN MH database (port 5434, service `postgresql-kun-18`) is separate from the Billing database (port 5432, service `postgresql-x64-18`). Its passwords are not shared with the Billing app.
- [ ] `server\.env` is not shared, emailed or copied. It contains the database password.
- [ ] Each person has their own account, and leavers are disabled promptly.
- [ ] Backups are made weekly and kept on another drive or server. They hold the business records (not staff e-mail or phone numbers), but they are still private.
- [ ] Access rights (**Admin > Access rights**) are reviewed by the Head of Accounts whenever a role changes (Part 11.3).
- [ ] The server is patched by IT, and the folders `logs` and `C:\KUN\backups` are not shared.

---

## Installation checklist

- [ ] Node.js 22 LTS checked (Part 1a)
- [ ] PostgreSQL 18 with the Command Line Tools installed, Billing database untouched (Part 1b)
- [ ] URL Rewrite 2.1 and Application Request Routing 3.0 installed (Parts 1c and 1d)
- [ ] HTTPS certificate thumbprint noted (Part 1e), or decided to add it later
- [ ] Server name added to DNS or known to the office network (Part 1f)
- [ ] Route A: steps 1 to 8 finished with no FAIL lines, `check-access.bat` clean. Route B: section 4.1 to 4.6 done
- [ ] The app opens from another computer, and the first log-in works
- [ ] First set-up completed (example or empty data), and the first backup made
- [ ] The server was restarted once, and the app and database came back by themselves
- [ ] `server\.env` does not set `DATA_MODE=tables` (unless the database was migrated, Part 12)
- [ ] Existing installation only: the upgrade checklists in Part 11 are complete
