# KUN Karbala - Maintenance & Housekeeping app

Service desk, procure-to-pay, stores and housekeeping control for the zaereen hotel (formats MH-01 to MH-24).

The app is one web page (`index.html`) served by a small Node.js server on a Windows Server. IIS passes the requests from the office network to that server. All records are kept in a PostgreSQL 16 database on the same server and shared live with every user. Nothing is kept only in the browser.

## Files

| File / folder | What it is | Published on a website? |
|---|---|---|
| `index.html` | The whole app (screens, calculations, Excel import/export). Served by the local server | No |
| `INSTALLATION_GUIDE.md` | **Start here.** Step-by-step installation on Windows Server 2016 with IIS | No |
| `iis\` | The IIS site folder. Holds only `web.config`, written by step 7 | No |
| `setup\` | The eight set-up scripts (`1-check-requirements.bat` to `8-backup.bat`) and their helpers | No |
| `logs\` | The server log, `server.log` (written when the app runs) | No |
| `server\` | The local server: Node.js code, database schema, account tool, browser adapter | No |
| `server\README.md` | Technical reference for the server and the commands behind the scripts | No |
| `server\.env` | **Your** database password and settings. Created by step 4, never committed | No |
| `.gitignore`, `.assetsignore` | Files kept out of git and off any public website | - |

## Quick start (Windows)

1. Install **Node.js 22 LTS** and **PostgreSQL 16**, and add the IIS add-ons **URL Rewrite 2.1** and **Application Request Routing 3.0**, as described in [INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md), Part 1.
2. Open the `setup` folder. Right-click each file and choose **Run as administrator**, in order:
   1. `1-check-requirements.bat`: checks the server.
   2. `2-install-packages.bat`: downloads the server packages (once).
   3. `3-create-database.bat`: creates the KUN MH database cluster (service `postgresql-kun-16`, port 5433) if needed, then the database `kun_mh` and the user `kunmh`.
   4. `4-configure.bat`: writes `server\.env` and tests the connection.
   5. `5-create-admin.bat`: creates a log-in for each person.
   6. `6-start-app.bat`: runs the app in the background (scheduled task `KUN-MH Server`).
   7. `7-setup-iis.bat`: sets up IIS, the office ports, the firewall and the address other computers use.
   - `check-access.bat` (any time): read-only check that the app is reachable from the network and that the app and database ports are closed to it.
   8. `8-backup.bat`: saves a database backup to `C:\KUN\backups` (run weekly).
3. From another computer, open `http://SERVER-NAME/`, log in with the first account and choose **Start with the example data** (training) or **Start empty** (real use).

Each script explains what it did and what to do next. Step 1 is safe to repeat at any time.

## Everyday use

| Task | How |
|---|---|
| Start the app | Double-click `setup\6-start-app.bat` (KUN MH database service `postgresql-kun-16` must be running) |
| Stop the app | Double-click `setup\stop-app.bat` |
| Check the log | Open `logs\server.log` |
| Stop the KUN MH database | Stop the app first, then stop the service `postgresql-kun-16` in services.msc (not the Billing service) |
| Add a person | Double-click `setup\5-create-admin.bat` |
| Change a password | `npm run user -- password EMAIL "NEW-PASSWORD"` in the `server` folder |
| Block a leaver | `npm run user -- disable EMAIL` (re-enable with `enable`) |
| List accounts | `npm run user -- list` |
| Back up | Double-click `setup\8-backup.bat`, or in the app **Admin > Data > Download backup** |
| Restore | In the app **Admin > Data > Restore from backup** |
| Reset everything for a test | Stop the app, then drop and recreate the database (see `server\README.md`) |

## Where the data lives

- All records are rows in the PostgreSQL table `kv_docs` (one row per document, stored as JSON). Settings, registers, users and the audit trail are all there.
- Log-ins are in `accounts`; sessions are in `sessions` (they expire after 12 hours).
- The browser keeps nothing: it reads the data from the server when the app opens and receives live updates when another user changes something.
- To look at the data directly, use pgAdmin (installed with PostgreSQL) or `psql`. Details are in `server\README.md`.

## Troubleshooting

The scripts print a clear message for most problems. The most common ones:

| Message | What to do |
|---|---|
| `Node.js is not installed` (step 1) | Install Node.js, open a new window, run step 1 again |
| `PostgreSQL is not running on port 5433` (step 1) | Start the service `postgresql-kun-16` in services.msc (see INSTALLATION_GUIDE.md, Part 1b) |
| `Could not connect to the database` (step 4) | Check the `kunmh` password from step 3 and that PostgreSQL is running |
| `Port 3100 is already in use` (step 6) | The app is probably already running. Run `setup\stop-app.bat`, then `6-start-app.bat` |
| `IIS answered with status 502` (step 7) | The app is not running. Run `6-start-app.bat` |
| `pg_dump.exe was not found` (step 8) | Install PostgreSQL with the Command Line Tools, or back up from the app |
| `password authentication failed for user "kunmh"` | The `DB_PASSWORD` in `server\.env` does not match the password of user `kunmh`. Run step 4 again with the right password |
| `database "kun_mh" does not exist` | Run step 3 |
| Browser shows *Loading the shared data* | Reload the page and check the server window for an error |

More detail is in `INSTALLATION_GUIDE.md`, Part 4.

## Security notes

- The app listens on `127.0.0.1` (the server only). Other computers reach it through IIS (step 7), which is limited to the allowed network and can use HTTPS. Keep `HOST=127.0.0.1`.
- Any log-in the server accepts can read and change all data. Access is limited only by the app's own user roles and log-ins. Keep the log-in list short and disable leavers promptly.
- `server\.env` holds the database password. It is excluded from git and from any public website.

## Changing the app

- Edit `index.html` (the app) or the files in `server\` (the local server). Restart the server after changing server code.
- Before committing, run `setup\1-check-requirements.bat` and `setup\6-start-app.bat`, and check that the app loads in the browser.
