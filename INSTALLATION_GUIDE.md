# KUN Maintenance & Housekeeping - Installation Guide (Windows, local)

The app runs as a small local server on one Windows computer, and all records are stored in a PostgreSQL 16 database on the same computer. Set-up takes about 30 minutes the first time.

The set-up is done with seven scripts in the `setup` folder. Run them in order, one at a time. Each script explains what it did and what to do next.

---

## Part 1 - Install the two programs (once, by hand)

You need administrator rights for these two installs.

### 1a. Node.js
1. Go to **https://nodejs.org** and download the **LTS** version (22 or 24).
2. Run the installer with the default options.

### 1b. PostgreSQL 16
1. Go to **https://www.postgresql.org/download/windows/** and download **PostgreSQL 16** for Windows x86-64.
2. Run the installer and keep the defaults:
   - Keep **PostgreSQL Server** and **Command Line Tools** ticked. pgAdmin 4 is optional.
   - Keep the **port 5432**.
   - **Write down the password you set for the `postgres` user.** Step 3 asks for it.
3. Finish the installer. It starts the Windows service **postgresql-x64-16**.

Then copy the app folder `kun-mh` to a permanent place, for example `C:\KUN\kun-mh`. Do not run it from the Downloads folder.

---

## Part 2 - Run the set-up scripts

Open the `setup` folder inside `kun-mh`. **Double-click** each file in turn. Read the window, follow the on-screen instructions, then press Enter to close it.

| Step | File to double-click | What it does |
|---|---|---|
| 1 | `1-check-requirements.bat` | Checks Node.js, PostgreSQL and the ports. Fix anything marked **FAIL** before going on. |
| 2 | `2-install-packages.bat` | Downloads the packages the server needs. One time only. |
| 3 | `3-create-database.bat` | Creates the database `kun_mh` and the database user `kunmh`. Asks for the `postgres` password and a new password for `kunmh`. |
| 4 | `4-configure.bat` | Saves the settings file `server\.env` and tests the connection. Asks for the `kunmh` password from step 3. |
| 5 | `5-create-admin.bat` | Creates the log-in accounts for the people who will use the app. Repeat for each person. |
| 6 | `6-start-app.bat` | Starts the app in a new window and opens it in the browser at http://localhost:3000. |
| 7 | `7-backup.bat` | Saves a copy of the database to `C:\KUN\backups`. Run it weekly. |

**Notes**

- Step 1 is safe to repeat at any time.
- Steps 3 and 4 ask you to type passwords. Nothing is shown while you type; that is normal.
- Step 5 asks for an email, a name and a password (at least 8 characters) for each person. Give each person their password **in person**.
- After step 6, log in with the first account. The first person to set up the app becomes the owner and chooses **Start with the example data** (for training) or **Start empty** (for real use).

---

## Part 3 - Everyday use

| Task | How |
|---|---|
| Start the app | Start PostgreSQL (see below), then double-click `6-start-app.bat` |
| Stop the app | Close the server window (or press Ctrl+C in it) |
| Start PostgreSQL | Open **services.msc** and start **postgresql-x64-16**, or run `net start postgresql-x64-16` in an administrator Command Prompt |
| Stop PostgreSQL | Stop the app first. Then stop **postgresql-x64-16** in **services.msc** |
| Back up | Double-click `7-backup.bat` (weekly). The backup is saved in `C:\KUN\backups` |
| Restore a backup | In the app: **Admin > Data > Restore from backup** |
| Add a person | Double-click `5-create-admin.bat` |
| Change a password or block a leaver | In a Command Prompt in the `server` folder: `npm run user -- password EMAIL "NEW-PASSWORD"` or `npm run user -- disable EMAIL` |

Copy the backup files to another drive or computer as well. A backup on the same disk does not protect against a disk failure.

---

## Part 4 - Troubleshooting

| Message | What to do |
|---|---|
| `Node.js is not installed` (step 1) | Install Node.js (Part 1a), then open a new window and run step 1 again |
| `PostgreSQL is not running on port 5432` (step 1) | Start the **postgresql-x64-16** service in services.msc |
| `PostgreSQL 16 was not found` (step 1) | Install PostgreSQL 16 (Part 1b) |
| `Could not connect to the database` (step 4) | Check the `kunmh` password, then run step 4 again. The PostgreSQL service must be running |
| `The database could not be created` (step 3) | Check the `postgres` password from the PostgreSQL installation and run step 3 again |
| `Port 3000 is already in use` (step 6) | The app is probably already running. Open http://localhost:3000. To restart, close the server window first |
| `The app did not start` (step 6) | Read the new server window for the error. Usually the settings in step 4 or PostgreSQL is not running |
| `pg_dump.exe was not found` (step 7) | Install PostgreSQL 16 with the **Command Line Tools** option, or make the backup in the app: **Admin > Data > Download backup** |
| *Wrong email or password* in the app | Check the spelling. An administrator can reset the password with the command in Part 3 |
| Browser shows *Loading the shared data* | Reload the page. Check the server window for an error |

When you report a problem, send the text from the script window and the last lines of the server window.

---

## Part 5 - Other computers on the office network (optional)

By default the app works only on the computer where it runs. To let others use it, an IT contact must:

1. Change `HOST=127.0.0.1` to `HOST=0.0.0.0` in `server\.env`.
2. Allow port 3000 in Windows Firewall.
3. Make sure HTTPS is placed in front of the app. The app has no HTTPS of its own.

Do not do this without IT approval.

---

## Security checklist

- [ ] The app listens on this computer only, unless IT has approved otherwise.
- [ ] `server\.env` is not shared, emailed or copied to other computers. It contains the database password.
- [ ] Each person has their own account, and leavers are disabled promptly.
- [ ] Backups are made weekly and kept off this computer.
- [ ] The `postgres` password is kept safe and is not used by the app.

---

## Installation checklist

- [ ] Node.js installed (Part 1a)
- [ ] PostgreSQL 16 installed and the service is running (Part 1b)
- [ ] Step 1 passed with no FAIL lines
- [ ] Step 2 finished (packages installed)
- [ ] Step 3 finished (database created)
- [ ] Step 4 finished (connection tested)
- [ ] Step 5 run for each person
- [ ] Step 6 opened the app in the browser
- [ ] First set-up completed (example or empty data)
- [ ] Step 7 made the first backup
