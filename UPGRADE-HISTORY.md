# KUN MH - upgrade history (1.9, 1.9.2, 2.2.0)

These are the upgrade steps for office servers installed before version 2.2.0. For a new install, use [INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md). For ongoing updates, use its Part 11 (the general procedure).

Every upgrade starts with the general procedure in INSTALLATION_GUIDE.md, Part 11: back up, keep a rollback copy, stop the app, copy the new files with `robocopy` (keeping `server\.env`), start the app, check. The steps below add what each version needs.

Replace `NEW-PACKAGE` with the folder of the new package, and `C:\KUN\kun-mh` with the installed folder.

Where a step uses `psql.exe`, use the PostgreSQL 18 programs (`C:\Program Files\PostgreSQL\18\bin`) against the shared cluster (`127.0.0.1`, port `5432`, database `kun_mh`, user `kunmh`), as in INSTALLATION_GUIDE.md, Part 3. A server that still runs PostgreSQL 16 must first move its data (INSTALLATION_GUIDE.md, Part 12).

---

## 1. Upgrade a server older than version 1.9

Use this when KUN MH runs on a server installed before 1.9. The database, the log-ins and the transactions (POs, GRNs, bills, job cards, payments, audit log) stay as they are. Master data is replaced with the 1.9 masters.

**What changes in version 1.9**

| Part | Change | How it is applied |
|---|---|---|
| Screens (`index.html`) | New screens **Consolidated cash PV** (MH-16B) and **Notifications and pending actions**. Job-card priorities are *High* and *Normal* only, with targets in days. Bills above the bill tolerance need variance approval. The default payment mode for new POs is *Cash* | Copy the new files |
| Database layout (`schema.sql`) | **No change** | Nothing to do |
| Server code (`server\src`, `server\client`) | Two new commands for master data (`masters:export`, `masters:import`) | Copy the new files |
| Settings and priority list | New settings keys, job-card targets in days, *Urgent* removed | `server\upgrade-1.9.sql` (step 4) |
| Job cards with priority *Urgent* | Become **High**. Any that should be *Normal* are changed in the app afterwards | `upgrade-1.9.sql` (step 4) |
| Master data: items, vendors, users, price list (MPL), budget lines, categories, lists, access rights, settings | Replaced with the 1.9 masters, from `KUN-MH-masters-1.9.json` | Import (step 5) |

The master-data import keeps the settings (approval passphrase, lock state, occupancy plan), the password fields of users, every transaction, the room status, the number log and the audit log. Rooms (`m_rooms`) are not part of the import.

**Before you start**

- The app folder must be `C:\KUN\kun-mh`, not a folder under `C:\Users\`. If it is under `C:\Users\`, do step 1c first.
- You need `psql.exe` (PostgreSQL 18 programs) and the password of `kunmh`.
- Get `KUN-MH-masters-1.9.json` from the office. It contains staff names and contact details: keep it on the server only.
- Plan about 30 minutes, outside working hours.

**Steps**

1. **Back up.** a. Run `setup\8-backup.bat` and check the new file is not empty. b. Copy the whole `kun-mh` folder to `C:\KUN\kun-mh-before-1.9`. c. If the app is under `C:\Users\`, copy it to `C:\KUN\kun-mh` and run the remaining steps from there, then run `6-start-app.bat` and `7-setup-iis.bat` once from the new folder.
2. **Stop the app.** `setup\stop-app.bat`.
3. **Copy the new files** with the `robocopy` command of the general procedure.
4. **Upgrade the settings and priorities.**
   ```bat
   cd C:\KUN\kun-mh\server
   "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h 127.0.0.1 -p 5432 -U kunmh -d kun_mh -f upgrade-1.9.sql
   ```
   Type the `kunmh` password when asked. The script prints `job_high_days` 1 and `job_normal_days` 2 (or the values derived from the old targets), `cpv_max` 5000000, `bill_tol` 0.1; `priorities` `["High", "Normal"]`; and no rows at the end (no *Urgent* job card is left). It runs in one transaction and can be run again.
5. **Load the master data.**
   ```bat
   npm run masters:import -- C:\KUN\masters\KUN-MH-masters-1.9.json --dry-run
   npm run masters:import -- C:\KUN\masters\KUN-MH-masters-1.9.json
   ```
   The dry run lists each master document as *new*, *changed* or *unchanged*, and saves nothing. Check it with the Head of Accounts before the real import. The last line says *Master data saved*.
5a. **Fix the roles.** Run `setup\9-fix-roles-1.9.bat` as administrator, with the app stopped. It shows the four changes (SIGAT1 and SIGAT2 to *Sigat*, TZAKI and TGHADIALI to *Internal Auditor*) and saves them only when you type `Y`.
6. **Start the app**, and check that the log ends with `KUN MH server running`.
7. **Check the screens.** The menu has **Consolidated cash PV** and **Notifications**; **Settings** section C shows the two targets in days; the job-card priority list shows *High* and *Normal*; the masters show the 1.9 values; existing POs, GRNs, bills and job cards keep their numbers and dates.
8. **Check the log-ins.** `npm run user -- list`; add missing people with `setup\5-create-admin.bat`.
9. **Review the former *Urgent* job cards** and change any that should be *Normal*.
10. **Review the settings** with the Head of Accounts (Settings, sections B and C).

**Rollback:** stop the app, copy `C:\KUN\kun-mh-before-1.9` back (without `/XF .env`), start the app. If the data must be undone, restore the backup from step 1a.

**Checklist (1.9):** backup and rollback folder; folder not under `C:\Users\`; new files copied, `server\.env` kept; `upgrade-1.9.sql` run without errors; master dry run reviewed and import saved; app started; masters checked; log-ins checked; former *Urgent* job cards reviewed; settings reviewed.

---

## 2. Apply the 1.9 update changes (for servers on 1.9)

Use this on an installation that runs version 1.9 (section 1). The database layout does not change and no packages are added.

**What changes**

| Area | Change | How it is applied |
|---|---|---|
| Screens (`index.html`) | **My desk** home page; **Items & MPL rates** (the MPL is on the Items page); **Log out** in the header (server mode); GRN **No PO** option; typed items on PO lines, with new items added to the item master | Copy the file |
| Server (`server\src\server.js`) | Sign-in locked for 30 seconds after three wrong passwords; Admin can set a temporary log-in password for a linked user; users can change their own password; each change is recorded in the audit log | Copy the file and restart the app |
| Users (`index.html`) | **My account** in the header: the person's details, password change, sign out | Copy the file |
| Access rights (`index.html`) | Table **Who may create records**: which roles may create purchase orders, GRNs, bills, issue slips, job cards, laundry hand-overs and consolidated PVs. Admin always may | Copy the file. Existing rights are kept |
| Notifications (`index.html`) | **Copy for e-mail** and an **E-mail** link on each pending notice | Copy the file |
| Roles | Sigat members and Internal Auditors set to their own role | Section 1, step 5a (once) |
| Vendor names | The 58 vendors with Arabic names are in English, with every saved reference changed | `setup\10-vendor-names-english.bat` (step 4a, once) |
| Budget codes | MT-01 to MT-05, HK-01 and HK-02 become one line **MT**; new line **SR**; HK item codes become ITM codes | `setup\11-budget-merge-1.9.bat` (step 4b, once) |

No data needs converting. The sign-in lock-out is held in memory and clears when the app restarts. Tell users to save their work and log out first.

**Steps**

1. Stop the app. 2. Back up (`setup\8-backup.bat`). 3. Copy the new files (`robocopy`). 4. No `npm install` is needed. 4a. Vendor names, once: `setup\10-vendor-names-english.bat`; names marked (2) may be duplicates. 4b. Budget codes, once: `setup\11-budget-merge-1.9.bat`; skip it if the old budget lines are reported as not found. 5. Start the app. 6. Roles, once: `setup\9-fix-roles-1.9.bat`. 7. Check the screens (My desk, My account, Log out, Copy for e-mail, Who may create records, typed items on PO lines, No PO on goods receipts). 8. As the Head of Accounts, check the **Reset log-in password** dialog on a linked user (use a test log-in, not a real user).

**Rollback:** copy the files back from the rollback folder, start the app.

---

## 3. Apply the version 1.9.2 changes (access, live updates, backups)

Use this on an installation that runs version 1.9 with the changes of section 2. The database layout does not change and no packages are added.

**What changes**

| Area | Change | Who notices |
|---|---|---|
| Access, reads (`server\src\permissions.js`, `server\src\app.js`) | A person sees only the records of the pages their role can see (Admin > Access rights). Records of other pages come back empty. Items, settings, lists, the user list, rooms and the logs stay visible to everyone | Every user. Check the roles before the update |
| Access, writes | A save to a page the role cannot edit is refused with *Your role may not change this page* | Every user who edits records |
| Live updates (`server\src\server.js`) | Changes are sent through the database (PostgreSQL `LISTEN`/`NOTIFY`) | Nobody |
| Backups (**Admin > Data**) | The backup keeps the business records and leaves out staff e-mail and phone numbers. Each backup is recorded in the audit log | Admin |
| Restore and reset | Type `RESTORE` or `RESET` to confirm; the dialog shows how many records it replaces | Admin |
| Calculation rules (`rules.js`) | Approval limits, bill tolerance, cash PV limit and advance status are in one file, checked by automatic tests | Nobody (same results) |

**Before you start:** in **Admin > Access rights**, check every role against the pages it uses; the Head of Accounts must agree the table before users are told. Make a backup, and tell users to save and log out.

**Steps**

1. Stop the app. 2. Back up (`setup\8-backup.bat`). 3. Copy the new files (`robocopy`); the new files are `rules.js`, `server\src\permissions.js` and `server\testing`. 4. No `npm install` is needed. 5. Turn on the secure cookie **only after HTTPS works**: add `COOKIE_SECURE=true` to `server\.env`. Without HTTPS, leave it out. 6. Start the app, and check the log. 7. As the Head of Accounts, check **Admin > Data** (the `RESTORE` and `RESET` words, the record counts), a backup file (no staff e-mail addresses; a `"backupNote"` line near the end), and the page rights table. Sign in as a GRN Officer, a Maintenance Masool and an Accounts user, and check their pages and a refused save. 8. Phone layout (optional): the Import page fits a 390-pixel screen.

**Rollback:** copy the files back from the rollback folder (without `/XF .env`), remove `COOKIE_SECURE=true` from `server\.env`, start the app.

---

## 4. Version 2.2.0 changes

**What changes for the office server**

| Area | Change |
|---|---|
| Goods receipt notes | A **No PO** receipt is refused when its value, at the master-price-list rates, is at or above the PO limit (500,000 IQD by default). The screen shows the reason |
| Bill entry | A bill is either **PO based** (choose the PO) or **No PO based** (choose a GRN with no PO that is not yet billed). The vendor, items and budget line fill in from the GRN |
| Dates | Business dates and "today" are computed in Asia/Baghdad time, whatever the computer's time zone. Before this version, the date could be one day behind before 03:00 |
| Calculation rules (`rules.js`) | Thresholds and the document-type rule are in one file, used by the page and the tests |
| Server code (`server\src`) | Access checks for documents, the data-mode switch (`DATA_MODE`), and the copy commands. With `DATA_MODE` not set, the office server works as before |
| Installation | Fresh installs use the shared PostgreSQL 18 cluster (service `postgresql-x64-18`, port 5432) and create only the role `kunmh` and the database `kun_mh`. The task and backup run as the account `kunapp`. Logs rotate at each start (10 MB, 14 days). Nightly backups (`pg_dump -Fc`, 14 days) |

The database layout does not change in kv mode. Nothing needs migrating for the office server, except a PostgreSQL 16 database, which is moved as described in INSTALLATION_GUIDE.md, Part 12.

**Steps:** stop the app; back up; copy the new files; check that `server\.env` does not set `DATA_MODE=tables` (unless migrated); start the app; check on **Goods receipt notes** (a No PO receipt at or above the limit is refused) and on **Bills** (the two bill types, and the GRN fill-in).

**Rollback:** as in the general procedure.
