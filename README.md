# KUN Karbala - Maintenance & Housekeeping app

Service desk, procure-to-pay, stores and housekeeping control for the zaereen hotel (formats MH-01 to MH-24).

The app is one web page (`index.html`) served by a small Node.js server (Express) with a PostgreSQL database. The browser keeps no business data: it reads everything from the server and receives live updates when another user changes something.

The same code runs in two places:

| Deployment | Where | How it is installed or run | Guide |
|---|---|---|---|
| **Office server** (on-premises) | Windows Server 2016, IIS in front, PostgreSQL 18 (shared cluster) on the same server | Set-up scripts in `setup\` | [INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md) |
| **Hosted** (staging) | Vercel (`api/index.js` runs the same Express app), Neon PostgreSQL | `vercel --prod` from this folder | [HOSTED-VERCEL.md](HOSTED-VERCEL.md) |

```
office browser  ->  IIS (8080 / 8443)  ->  Node.js app (127.0.0.1:3100)  ->  PostgreSQL 18 (127.0.0.1:5432, database kun_mh)

browser         ->  Vercel function (api/index.js)                       ->  Neon PostgreSQL (DATABASE_URL)
```

**Version 2.2.0.** The app page (`index.html`) and both packages (`package.json`, `server\package.json`) carry this version. The install guide's Parts 7 to 9 describe the earlier 1.9 upgrades, kept for reference.

## Files

| File / folder | What it is | Needed for |
|---|---|---|
| `index.html` | The whole app: screens, Excel import and export, the page logic. It loads `rules.js` and the server adapter | Both |
| `rules.js` | Calculation rules (approval limits, PO and quotation thresholds, bill tolerance, advance status). Pure functions, tested by `server\test\rules.test.js` | Both |
| `api\index.js` | Vercel entry point: one Express app for every request | Hosted |
| `vercel.json` | Vercel routes and the files the function includes | Hosted |
| `package.json`, `package-lock.json` | Root packages for Vercel (Express, bcryptjs, pg) | Hosted |
| `setup\` | Windows set-up scripts (`1-check-requirements.bat` to `8-backup.bat`), `check-access.bat`, `stop-app.bat`, and the helper scripts for the 1.9 upgrade | Office server |
| `INSTALLATION_GUIDE.md` | Step-by-step installation and upgrade on Windows Server with IIS. The hosted site is in HOSTED-VERCEL.md; upgrades are in UPGRADE-HISTORY.md | Office server (and hosted, Part 10) |
| `server\` | The Node.js server: `src\` (the app and its commands), `client\server-adapter.js` (browser side), `schema.sql` and `schema-tables.sql` (database layout), `test\` (automatic tests), `testing\` (a local test server, not for the live system) | Both |
| `server\README.md` | Technical reference: manual commands, environment settings, data modes, migrations | Both |
| `server\upgrade-1.9.sql` | One-time data upgrade for installations made before 1.9 (UPGRADE-HISTORY.md, section 1) | Office server (old installs) |
| `server\.env`, `.env.local` | **Local secrets** (database URL or password). Git-ignored; never committed or shared | Both |
| `archive\` | Old documents, one-off scripts and run reports, kept for reference. Not used by the app. Git-ignored and excluded from Vercel | None |

Generated folders, all git-ignored: `node_modules\`, `logs\` (office server log), `iis\` (created by setup step 7), `.vercel\` (Vercel project link and build output).

## Quick start

**Office server (Windows):** follow [INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md) from Part 1. In short, in the `setup` folder, run these as administrator, in order: `1-check-requirements.bat`, `2-install-packages.bat`, `3-create-database.bat`, `4-configure.bat`, `5-create-admin.bat` (once per person), `6-start-app.bat`, `7-setup-iis.bat`. Then `8-backup.bat` weekly.

**Development or tests (any machine with Node.js 22.9 or later):**

```bat
cd server
npm install
npm test                          rem 68 automatic tests
copy .env.example .env            rem then set DATABASE_URL, or DB_* values, for a local PostgreSQL
npm start                         rem http://127.0.0.1:3100
```

## What the app does

The left-hand menu groups the screens. The format code in brackets is the paper form each screen replaces.

| Group | Screens (format) |
|---|---|
| Overview | My desk; Dashboard & exceptions (MH-24); Service desk & rooms (MH-22); How the process works (guide) |
| Maintenance | Job card register (MH-22); PPM schedule & AMC register (MH-23) |
| Purchasing | Purchase orders (MH-06/07); Advances to vendors (MH-09/10) |
| Receiving | Goods receipt notes (MH-11/12); Service receipt notes (MH-13/14) |
| Bills & payment | Bill lines and bill entry (MH-15); Bills & payment vouchers (MH-15/16A); Pre-payment audit & payments (MH-16); Consolidated cash PV (MH-16B) |
| Stores | Material issue slips (MH-17); Stores stock & month-end count (MH-18) |
| Housekeeping | Housekeeping consumables vs norm (MH-19); Linen par & laundry summary (MH-20); Laundry log (MH-21) |
| Masters | Items & MPL rates (MH-03); Approved vendors (MH-04); Budget, monthly phasing (MH-02); Settings, thresholds & authority matrix (MH-01); Import from Excel |
| Admin | Users; Access rights; Audit log; Notifications and pending actions; Number log; Data (backup, restore, reset) |

Main rules built into the calculation engine:

- **Approval:** the authority matrix and the thresholds are set in **Settings**. Locked settings need an unlock by an administrator.
- **Which document:** below the PO limit (500,000 IQD by default) goods or services go on a bill with a payment voucher and no PO; from the limit, a Purchase Order; above the quotation threshold, a PO-cum-Quotation with the quotations required.
- **No PO goods receipts (GRN):** a GRN without a PO is refused when its value, at the master-price-list rates, is at or above the PO limit. The screen shows the reason.
- **Bill entry:** a bill is either *PO based* (choose the PO) or *No PO based* (choose a GRN that has no PO and is not yet billed). The vendor, the items and the budget line fill in from the GRN.
- **Budget** is tracked per month (IQD). The dashboard shows the exceptions that should be zero.
- **Document numbers** are allocated by the server, so two people never receive the same number (short locks through `POST /api/lease`).
- **Every change** is written to the audit log.

## Users, roles and access

Roles: **Admin**, **Sigat**, **Internal Auditor**, **Maintenance Masool**, **GRN Officer**, **HK Supervisor**, **Accounts**. The Admin screen can add roles (up to 20).

- Each person has one log-in (email and password) and one role. Accounts are created with `setup\5-create-admin.bat` (office server) or `npm run user -- add` (server); there is no self sign-up.
- **Access rights** (Admin > Access rights) set, for each page and each role, one of three levels: **E** (edit), **V** (view only) or **H** (hidden). Admins always have E. A table **Who may create records** sets which roles may create each kind of record.
- **The server enforces these rights.** A document read from a collection the role cannot see comes back empty. A save to a collection the role cannot edit is refused with HTTP 403. The browser also hides the pages a role cannot use, but the server is the one that decides. Some routes check only that the person is signed in (for example the people lookup and the number lease); see the security notes.
- Passwords are stored as bcrypt hashes. Sessions last 12 hours. Three wrong passwords lock the log-in for 30 seconds.

## Where the data lives

The server stores the data in one of two ways, chosen by the `DATA_MODE` setting:

| `DATA_MODE` | Where the data is | Used by |
|---|---|---|
| `kv` (default) | Table `kv_docs`: one row per document, the document stored as JSON. Collections include settings (`cfg`), registers (`m_pos`, `m_grns`, ...), users, the audit trail and the number log | Office server; hosted until the cutover |
| `tables` | Relational tables from `server\schema-tables.sql`: one table per record type, with typed columns, the full record kept as JSON, and line tables (PO lines, GRN lines, bill items, ...). The browser still receives the same documents | Hosted after the cutover |

- The two modes return the same documents to the browser. `server\testing\parity-tables.js` compares them.
- Copying between the modes is done with `npm run migrate:tables` (kv to tables) and `npm run migrate:kv` (tables to kv). Both dry-run by default. See [server/README.md](server/README.md).
- Log-ins are in `accounts`; sessions are in `sessions` (only a SHA-256 hash of the session token is stored).
- The browser keeps no business data. The only thing kept in its local storage is the column mapping chosen during Excel import, and only when the app is not running on the server.

## Server API

All routes except log-in require a valid session cookie.

| Route | Purpose |
|---|---|
| `POST /api/login`, `POST /api/logout`, `GET /api/me` | Log-in, log-out, current user |
| `POST /api/me/password` | Change your own password (also signs you out everywhere else) |
| `POST /api/admin/reset-password` | Admin: set a temporary password for a linked user |
| `GET /api/people?ids=…` or `?q=…` | Names and emails for the people shown in the app |
| `GET /api/docs/:coll`, `GET /api/docs/:coll/:id` | Read one collection or one document (role-filtered) |
| `PUT /api/docs/:coll/:id` | Save a document; `merge: true` merges into the existing one. Refused (403) without write access |
| `DELETE /api/docs/:coll/:id` | Delete a document. Refused (403) without write access |
| `POST /api/lease` | Short lock on a document (used for document numbering) |
| `GET /api/events` | Live-update stream: the browser is told which collection changed |
| `GET /`, `GET /index.html` | The app page, with the browser adapter added |

Collection and document names are checked against a strict pattern; anything else gets HTTP 400.

## Troubleshooting

For the office server, the set-up scripts print a clear message for most problems. See [INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md), Part 10. The most common ones:

| Message or symptom | What to do |
|---|---|
| `Node.js is not installed` (step 1) | Install Node.js 22 LTS, open a new window, run step 1 again |
| `PostgreSQL is not running on port 5432` (step 1) | Start the service `postgresql-x64-18` in services.msc |
| `password authentication failed for user "kunmh"` | The `DB_PASSWORD` in `server\.env` does not match user `kunmh`. Run step 4 again with the right password |
| `Port 3100 is already in use` (step 6) | The app is probably running already. Run `setup\stop-app.bat`, then `6-start-app.bat` |
| `IIS answered with status 502` (step 7) | The app is not running. Run `6-start-app.bat` |
| Browser shows *Loading the shared data* | Reload the page and check `logs\server.log` for an error |
| *Your role may not change this page* | The role cannot edit that page. The Head of Accounts can change the access rights |
| Hosted: the page loads but data does not | Check `DATABASE_URL` and `DATA_MODE` for the environment (Vercel dashboard), then the function logs |

## Everyday use (office server)

| Task | How |
|---|---|
| Start the app | `setup\6-start-app.bat` (the PostgreSQL service `postgresql-x64-18` must be running). It also starts after a restart |
| Stop the app | `setup\stop-app.bat` |
| Check the log | Open `logs\server.log` |
| Add a person | `setup\5-create-admin.bat` |
| Change a password | `npm run user -- password EMAIL "NEW-PASSWORD"` in the `server` folder |
| Block a leaver | `npm run user -- disable EMAIL` (re-enable with `enable`) |
| Back up | `setup\8-backup.bat` (weekly), or in the app **Admin > Data > Download backup** |
| Restore | In the app **Admin > Data > Restore from backup** (type `RESTORE`) |

## Ports (office server)

| Port | Used by | Reachable from |
|---|---|---|
| 8080 (8443 with HTTPS) | IIS, for office users | Office network only (firewall rule from step 7) |
| 3100 | KUN MH Node app | This server only |
| 5432 | PostgreSQL 18, shared with the Billing app (KUN MH has its own database) | This server only |
| 3000, 80, 443 | Billing application, and NKERP, on the same server | Not used by KUN MH; the scripts refuse them |

## Security notes

- **Access rights are enforced on the server** for document reads and writes (see Users, roles and access). Routes that need only a signed-in user (the people lookup, the number lease, and the live-update stream) are open to every signed-in person.
- The app listens on `127.0.0.1`. On the office server, IIS is in front and applies the network restriction and HTTPS. Keep `HOST=127.0.0.1`.
- Session cookies are `HttpOnly` and `SameSite=Strict`. They are marked `Secure` when `COOKIE_SECURE=true` is set; turn it on once HTTPS works (guide, Part 9).
- `.env` and `.env.local` hold database credentials. They are git-ignored and must not be shared, emailed or copied.
- Backups contain all business records, including password hashes. Keep backups and `logs\` private. Backups leave out staff e-mail and phone numbers.
- The `archive\` folder holds run reports that contain database host names. It is git-ignored; keep it out of shared folders.

## Tests

`cd server` then `npm test` runs 68 automatic tests (permissions, rules, the document API, the vendor and role scripts, the calculation rules and the browser page). They do not need a database: they use a test pool (`server\testing\fake-pool.js`). The database copy and parity checks are run by hand (`server\testing\parity-tables.js` and the migration dry runs), against a database you choose.

## Changing the app

- Edit `index.html` (the app), `rules.js` (the calculation rules), or the files in `server\` (the server). Restart the server after changing server code.
- Run `npm test` in `server` before committing.
- Keep the setup scripts and `INSTALLATION_GUIDE.md` in step with any change to ports, paths, service names or environment settings.
- Put old documents, one-off scripts and run reports in `archive\`, not in the main folders.

## Known gaps

- The version numbers differ between `index.html` (2.2) and `package.json` (1.9.2). To be decided.
- The browser checks the access rights for the screens; the server checks them only for document reads and writes.
- Live updates are not sent on Vercel. The Vercel entry point (`api/index.js`) does not start the database listener that carries them, because a serverless function cannot keep that connection open. Hosted users see other people's changes when they reload.
- `iis\` and `logs\` are created by the set-up scripts and are not in the repository.
