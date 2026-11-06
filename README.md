# KUN Karbala - Maintenance & Housekeeping app

Service desk, procure-to-pay, stores and housekeeping control for the zaereen hotel (formats MH-01 to MH-24).

The app is one web page (`index.html`) served by a small Node.js server on a Windows Server. IIS passes the requests from the office network to that server. All records are kept in a PostgreSQL 16 database on the same server and shared live with every user. The browser keeps no business data; it reads everything from the server.

```
office browser  ->  IIS on the server (8080, or 8443 with HTTPS)
                ->  Node.js app, Express (127.0.0.1:3100, private)
                ->  PostgreSQL 16 cluster "postgresql-kun-16" (127.0.0.1:5433, database kun_mh)
```

History: earlier versions were deployed to Cloudflare (see git history). The app now runs only on the local server, with its own database.

## Files

| File / folder | What it is | Published on a website? |
|---|---|---|
| `index.html` | The whole app: screens, calculation engine, Excel import/export. Served by the local server | No |
| `INSTALLATION_GUIDE.md` | **Start here.** Step-by-step installation on Windows Server 2016 with IIS | No |
| `setup\` | The set-up scripts (`1-check-requirements.bat` to `8-backup.bat`), `check-access.bat`, `stop-app.bat` and their helpers | No |
| `iis\` | Created by step 7 when it runs. Holds `web.config` (proxy to the app). Not in the repository | No |
| `logs\` | `server.log`, written when the app runs. Git-ignored | No |
| `server\` | The local server: Node.js code, database schema, account tool, browser adapter | No |
| `server\README.md` | Technical reference for the server and the commands behind the scripts | No |
| `server\.env` | **Your** database password and settings. Created by step 4, never committed | No |
| `.gitignore` | Keeps `node_modules/`, `.env`, `server/.env.bak` and `logs/` out of git | - |

## Quick start (Windows)

1. Install **Node.js 22 LTS** and **PostgreSQL 16** (with Command Line Tools), and add the IIS add-ons **URL Rewrite 2.1** and **Application Request Routing 3.0**, as described in [INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md), Part 1.
2. Open the `setup` folder. Right-click each file and choose **Run as administrator**, in order:
   1. `1-check-requirements.bat`: checks the server and that the ports are free. Safe to repeat.
   2. `2-install-packages.bat`: downloads the server packages (once).
   3. `3-create-database.bat`: creates the KUN MH database cluster (service `postgresql-kun-16`, port 5433, data in `C:\KUN\pgdata-kun`) if needed, then the database `kun_mh` and the user `kunmh`.
   4. `4-configure.bat`: writes `server\.env` and tests the connection.
   5. `5-create-admin.bat`: creates a log-in for each person. Repeat for each person.
   6. `6-start-app.bat`: runs the app in the background (scheduled task `KUN-MH Server`).
   7. `7-setup-iis.bat`: sets up IIS, the office ports (8080, and 8443 with a certificate), the firewall and the address other computers use.
   - `check-access.bat` (any time): read-only check that the app is reachable from the network and that the app and database ports are closed to it.
   8. `8-backup.bat`: saves a database backup to `C:\KUN\backups` (run weekly).
3. From another computer, open `http://SERVER-NAME:8080/`, log in with the first account and choose **Start with the example data** (training) or **Start empty** (real use).

Each script explains what it did and what to do next.

## What the app does

The left-hand menu groups the screens. The format code in brackets is the paper form each screen replaces.

| Group | Screens (format) |
|---|---|
| Overview | Dashboard & exceptions (MH-24); Service desk & rooms (MH-22); How the process works (guide) |
| Maintenance | Job card register (MH-22); PPM schedule & AMC register (MH-23) |
| Purchasing | Purchase orders (MH-06/07); Advances to vendors (MH-09/10) |
| Receiving | Goods receipt notes (MH-11/12); Service receipt notes (MH-13/14) |
| Bills & payment | Bills & payment vouchers (MH-15/16A); Pre-payment audit & payments (MH-16); Consolidated cash PV (MH-16B) |
| Stores | Material issue slips (MH-17); Stores stock & month-end count (MH-18) |
| Housekeeping | Housekeeping consumables vs norm (MH-19); Linen par & laundry summary (MH-20); Laundry log (MH-21) |
| Masters | Items & services (MH-03); Approved vendors (MH-04); Master price list (MH-05); Budget, monthly phasing (MH-02); Settings, thresholds & authority matrix (MH-01); Import master data from Excel |
| Admin | Users; Access rights; Audit log; Notifications and pending actions; Number log; Data, backup & go-live |

Main rules built into the calculation engine:

- Approval thresholds and the authority matrix are set in **Settings**. Locked settings need an unlock by an administrator.
- Budget lines are tracked per month (IQD). The dashboard shows exceptions that should be zero.
- Document numbers are allocated by the server, so two people never receive the same number (short locks, see `/api/lease` below).
- Every change is written to the audit log.

## Users, roles and access

Roles: **Admin**, **Sigat**, **Internal Auditor**, **Maintenance Masool**, **GRN Officer**, **HK Supervisor**, **Accounts**.

- Each person has one log-in (email and password) and one role. Accounts are created with `setup\5-create-admin.bat`; there is no self sign-up.
- **Access rights** (Admin screen) set, for each screen and each role, one of three levels: **E** (edit), **V** (view only) or **H** (hidden). Admins always have E.
- Passwords are stored as bcrypt hashes. Sessions last 12 hours.

See the Security notes below: these access levels are enforced by the browser, not by the server.

## Where the data lives

- All records are rows in the PostgreSQL table `kv_docs`: one row per document, with the document stored as JSON. Collections include settings (`cfg`), registers, users, the audit trail and the number log.
- Log-ins are in `accounts`; sessions are in `sessions` (only a SHA-256 hash of the session token is stored).
- The browser does not store business data. It loads the data from the server when the app opens and receives live updates when another user changes something (Server-Sent Events). The only thing kept in the browser's local storage is the column mapping chosen during Excel import (the app uses local storage for the data only when it is not running on the server).
- To look at the data directly, use pgAdmin (installed with PostgreSQL) or `psql`. Details are in `server\README.md`.

## Server API (for reference)

All routes except log-in require a valid session cookie.

| Route | Purpose |
|---|---|
| `POST /api/login`, `POST /api/logout`, `GET /api/me` | Log-in, log-out, current user |
| `GET /api/people?ids=…` or `?q=…` | Names and emails for the people shown in the app |
| `GET /api/docs/:coll`, `GET /api/docs/:coll/:id` | Read one collection or one document |
| `PUT /api/docs/:coll/:id` | Save a document; `merge: true` merges into the existing one (nested objects merge key by key, arrays are replaced) |
| `DELETE /api/docs/:coll/:id` | Delete a document |
| `POST /api/lease` | Short lock on a document (used for document numbering) |
| `GET /api/events` | Live-update stream: the browser is told which collection changed |
| `GET /` | The app page, with the browser adapter (`server\client\server-adapter.js`) added |

Collection and document names are checked against a strict pattern; anything else gets HTTP 400.

## Troubleshooting

The scripts print a clear message for most problems. The most common ones:

| Message | What to do |
|---|---|
| `Node.js is not installed` (step 1) | Install Node.js 22 LTS, open a new window, run step 1 again |
| `PostgreSQL is not running on port 5433` (step 1) | Start the service `postgresql-kun-16` in services.msc (see INSTALLATION_GUIDE.md, Part 1b) |
| `Could not connect to the database` (step 4) | Check the `kunmh` password from step 3 and that PostgreSQL is running |
| `Port 3100 is already in use` (step 6) | The app is probably already running. Run `setup\stop-app.bat`, then `6-start-app.bat` |
| `IIS answered with status 502` (step 7) | The app is not running. Run `6-start-app.bat` |
| `pg_dump.exe was not found` (step 8) | Install PostgreSQL with the Command Line Tools, or back up from the app |
| `password authentication failed for user "kunmh"` | The `DB_PASSWORD` in `server\.env` does not match the password of user `kunmh`. Run step 4 again with the right password |
| `database "kun_mh" does not exist` | Run step 3 |
| Browser shows *Loading the shared data* | Reload the page and check `logs\server.log` for an error |
| Browser shows the log-in page with *Your log-in has ended* | The 12-hour session has expired, or the account was disabled. Log in again |

More detail is in `INSTALLATION_GUIDE.md`, Part 6.

## Everyday use

| Task | How |
|---|---|
| Start the app | Double-click `setup\6-start-app.bat` (database service `postgresql-kun-16` must be running). It also starts by itself after a restart |
| Stop the app | Double-click `setup\stop-app.bat` |
| Check the log | Open `logs\server.log` |
| Stop the KUN MH database | Stop the app first, then stop the service `postgresql-kun-16` in services.msc (not the Billing service `postgresql-x64-16`) |
| Add a person | Double-click `setup\5-create-admin.bat` |
| Change a password | `npm run user -- password EMAIL "NEW-PASSWORD"` in the `server` folder |
| Block a leaver | `npm run user -- disable EMAIL` (re-enable with `enable`) |
| List accounts | `npm run user -- list` |
| Back up | Double-click `setup\8-backup.bat` (weekly), or in the app **Admin > Data > Download backup** |
| Restore | In the app **Admin > Data > Restore from backup** |
| Reset everything for a test | Stop the app, then drop and recreate the database (see `server\README.md`) |

## Ports

| Port | Used by | Reachable from |
|---|---|---|
| 8080 (8443 with HTTPS) | IIS, for office users | Office network only (firewall rule from step 7) |
| 3100 | KUN MH Node app | This server only |
| 5433 | KUN MH PostgreSQL | This server only |
| 3000, 80, 443, 5432 | Billing application on the same server | Not used by KUN MH; the scripts refuse them |

## Security notes

- The app listens on `127.0.0.1` (this server only). Other computers reach it through IIS (step 7), which is limited to the allowed network and can use HTTPS. Keep `HOST=127.0.0.1`.
- **Role-based access is enforced in the browser only.** The screen rights (E / V / H) decide what each user sees and can change in the app, but the server accepts any valid log-in's requests to read and write any collection. Anyone with a log-in who uses the browser's developer tools or calls the API directly can bypass these rights. Until the server checks roles, limit the log-in list to people you trust, and disable leavers promptly.
- Session cookies are `HttpOnly` and `SameSite=Strict`, but not marked `Secure`. Use HTTPS (step 7, Part 5 of the installation guide) so that log-ins are encrypted on the network.
- `server\.env` holds the database password. It is git-ignored and must not be shared, emailed or copied.
- Backups contain all data, including password hashes. Keep `C:\KUN\backups` and `logs\` private and off shared drives.

## Known gaps

- Server-side role checks are not implemented (see Security notes).
- `iis\` and `logs\` are created by the set-up scripts and are not in the repository.
- The repository has no automated tests. Check changes by running `setup\1-check-requirements.bat` and `setup\6-start-app.bat`, and loading the app in a browser.

## Changing the app

- Edit `index.html` (the app) or the files in `server\` (the local server). Restart the server after changing server code (`setup\stop-app.bat`, then `setup\6-start-app.bat`).
- Before committing, run `setup\1-check-requirements.bat` and `setup\6-start-app.bat`, and check that the app loads in the browser and that you can log in.
- Keep the setup scripts and `INSTALLATION_GUIDE.md` in step with any change to ports, paths or service names.
- Upgrading an installed copy (for example the hosted one) to version 1.9: follow Part 7 of `INSTALLATION_GUIDE.md`. It copies the new files and runs `server\upgrade-1.9.sql` once. The database layout did not change in 1.9.
