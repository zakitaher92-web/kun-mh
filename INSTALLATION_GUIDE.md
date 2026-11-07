# KUN Maintenance & Housekeeping - Installation Guide (Windows Server 2016 with IIS)

The app runs on one Windows Server. Its records are stored in a PostgreSQL 16 database on the same server. **IIS** (the web server built into Windows) receives the requests from other computers on the office network and passes them to the app. Other people open the app in their browser; they do not install anything.

```
Other computers' browsers  ->  IIS on the server (port 8080, or 8443 with HTTPS)
                                  ->  KUN app on the server (127.0.0.1:3100, private)
                                        ->  KUN MH PostgreSQL on the server (port 5433, private)
```

**Ports used by KUN MH**

| Service | Port | Reachable from | Set by |
|---|---|---|---|
| IIS, HTTP (office users) | **8080** | Office network (firewall rule from step 7) | Step 7 (Enter takes 8080) |
| IIS, HTTPS (office users) | **8443** | Office network (firewall rule from step 7) | Step 7 (asked only with a certificate) |
| KUN app (Node) | **3100** | This server only (127.0.0.1). IIS forwards to it | `PORT` in `server\.env` (step 4) |
| KUN MH PostgreSQL (service `postgresql-kun-16`) | **5433** | This server only | Step 3 creates the cluster; `DB_PORT` in `server\.env` (step 4) |

**Do not use these ports for KUN MH.** They are used by other applications on this server: **3000** (Billing app), **80** and **443** (Billing IIS site), **5432** (Billing PostgreSQL). The scripts refuse them.

The Billing app's PostgreSQL (service `postgresql-x64-16`, port 5432) is not changed by any KUN MH step.

Set-up takes about one hour the first time. Node.js and the PostgreSQL programs are already installed on the server, so you start at Part 1.

**Before you start**

- You need an administrator account on the server, and the server must be on the office network.
- Use Node.js **22 LTS**. It is the version known to run well on Windows Server 2016.
- Copy the app folder `kun-mh` to a permanent place on the server, for example `C:\KUN\kun-mh`. Do not run it from the Downloads folder or from a network share.

---

## Part 1 - Check and install the programs (once, by hand)

### 1a. Node.js 22 (already installed: check only)
1. Open **Command Prompt** and run `node -v`. It must show `v22.9.0` or newer.
2. If it does not, install the **22 LTS** version from https://nodejs.org (default options), then open a new Command Prompt.

### 1b. PostgreSQL programs (already installed: check only)
1. The folder `C:\Program Files\PostgreSQL\16\bin` must exist. It comes with the PostgreSQL 16 installation used by the Billing app, with the **Command Line Tools** option. If it is missing, install PostgreSQL 16 with that option (this does not affect the Billing database).
2. Do **not** change the Billing app's service `postgresql-x64-16` or its port 5432.

The KUN MH database cluster is created by **step 3** of the scripts (service `postgresql-kun-16`, port 5433). You do not create it by hand.

### 1c. URL Rewrite 2.1 (IIS add-on, install by hand)
1. Go to **https://www.iis.net/downloads/microsoft/url-rewrite** and download the x64 installer.
2. Run it with the default options.

### 1d. Application Request Routing 3.0 (IIS add-on, install by hand)
1. Go to **https://www.iis.net/downloads/microsoft/application-request-routing** and download the installer.
2. Install it **after** URL Rewrite, with the default options. Accept the prompts that appear.

IIS itself (the Web Server role) is installed by step 7 of the scripts.

### 1e. HTTPS certificate (recommended, ask IT)
Users' passwords and records should travel encrypted. A certificate belongs to a **name**, not to an application, so the certificate used for the Billing app can be used for KUN MH too, if it covers the name that KUN MH users will type (see the rule below). You do not need a separate certificate in that case. Note its **thumbprint**; step 7 asks for it. Part 5 explains how to find it.

- **Reuse the Billing certificate** if its names include the KUN MH server name, for example `server.yourcompany.local` or a wildcard such as `*.yourcompany.local`. Both sites can use one certificate: KUN MH uses port 8443 and Billing uses 443.
- **Otherwise** ask IT for a certificate that includes the name KUN MH users will type, or a separate certificate for it. Step 7 warns if the name is not covered.
- A certificate must have its private key on this server and must not expire within 14 days. Step 7 checks both.

You can start without a certificate and add one later.

### 1f. Server name (ask IT)
Other computers reach the app by the server's name (for example `kun-mh`) or its IP address. IT should add the name to DNS, or the name must be known on the office network. Step 7 shows both addresses at the end.

---

## Part 2 - Run the set-up scripts

Open the `setup` folder inside `kun-mh`. For each step, **right-click** the `.bat` file and choose **Run as administrator**. Read the window, follow the instructions, then press Enter to close it. Run the steps in order.

| Step | File | What it does |
|---|---|---|
| 1 | `1-check-requirements.bat` | Checks Node.js, the PostgreSQL programs, IIS URL Rewrite and ARR, and that the KUN MH ports are free. Fix anything marked **FAIL** before going on. |
| 2 | `2-install-packages.bat` | Downloads the packages the server needs. One time only. |
| 3 | `3-create-database.bat` | Creates the KUN MH database cluster (service `postgresql-kun-16`, port 5433, data in `C:\KUN\pgdata-kun`) if it does not exist, then the database `kun_mh` and the user `kunmh`. |
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
- **Step 5** asks for an email, a name and a password (at least 8 characters) for each person. Give each person their password **in person**.
- **Step 7** asks these questions:
  1. **Which computers may open the app.** Press Enter for *LocalSubnet* (computers on the same network as the server). Type one or more ranges separated by commas, such as `10.10.0.0/16,10.20.0.0/16`, if the office uses several networks. Ask IT if you are not sure.
  2. **Certificate thumbprint.** Paste it (Part 5), or press Enter to skip HTTPS for now.
  3. **Port for HTTP**, and with a certificate **port for HTTPS**. Press Enter for **8080** and **8443**. Do not choose 80, 443, 3000 or 5432.
  4. **Stop a website on that port?** Only if the step finds another IIS website using it. A website is stopped, not deleted.
- Step 7 also creates the IIS application pool **KUN-MH** (no .NET) and the Windows Firewall rules, and removes old KUN MH rules and bindings from an earlier run.
- After step 7, run `check-access.bat`, then log in with the first account from another computer. The first person to set up the app becomes the owner and chooses **Start with the example data** (for training) or **Start empty** (for real use).

---

## Part 3 - Everyday use (on the server)

| Task | How |
|---|---|
| Start the app | Double-click `setup\6-start-app.bat` (it starts the scheduled task **KUN-MH Server**). Normally it starts by itself after a restart. |
| Stop the app | Double-click `setup\stop-app.bat`. Users then see an error page until the app is started again. |
| Restart the app | Run `stop-app.bat`, then `6-start-app.bat` |
| Check access | Double-click `setup\check-access.bat` |
| Check the app's log | Open `kun-mh\logs\server.log` in Notepad. The newest lines are at the bottom. |
| Start or stop the KUN MH database | **services.msc** > **postgresql-kun-16** (not the Billing service **postgresql-x64-16**) |
| Back up | Double-click `setup\8-backup.bat` (weekly). The backup is saved in `C:\KUN\backups` |
| Restore a backup | In the app: **Admin > Data > Restore from backup** |
| Add a person | Double-click `setup\5-create-admin.bat` |
| Change a password or block a leaver | In a Command Prompt in the `server` folder: `npm run user -- password EMAIL "NEW-PASSWORD"` or `npm run user -- disable EMAIL` |
| Change who may open the app, or the ports | Re-run `setup\7-setup-iis.bat` and answer the questions again |
| Restart IIS | Command Prompt as administrator: `iisreset` |

Copy the backup files to another drive or server as well. A backup on the same disk does not protect against a disk failure.

---

## Part 4 - Use from other computers

Tell the users the address, for example `http://kun-mh:8080/` or `http://10.10.1.25:8080/` (the server's name or IP address, and the port you chose in step 7; 8080 by default). Step 7 shows both at the end.

**Test it once from another computer (on the office network)**

1. Open a browser and go to the address. The log-in page must appear.
2. Log in with an account from step 5.
3. If HTTPS is set up, open `https://kun-mh:8443/` and check that the padlock shows and the certificate name matches.

**If other computers cannot open it**

- Run `check-access.bat` on the server. It shows which check fails and what to do.
- Check that the other computer is on the network allowed in step 7 (the first question). Re-run step 7 if the office network is wider.
- Use the IP address instead of the name if the name does not work. The name only works when the network knows it (ask IT to add it to DNS).
- Check the Windows Firewall rules **KUN-MH IIS port 8080** (and 8443) in *Windows Firewall with Advanced Security*.
- Check that the server's network profile is *Private* or *Domain* if the firewall rules do not seem to apply.

**What must stay closed.** Only IIS (8080 and 8443) is reachable from the network. Ports **3100** (the app) and **5433** (the database) must not answer from other computers. `check-access.bat` tests this.

---

## Part 5 - HTTPS certificate

With HTTPS, the browser shows a padlock and the log-in is encrypted.

1. Ask IT for a certificate for the server's name, installed in **Local Computer > Personal**. A certificate from the company certificate authority is best, because the browsers on the office computers already trust it.
2. Find the thumbprint: press Win+R, type `certlm.msc`, open **Personal > Certificates**, double-click the certificate, open the **Details** tab, select **Thumbprint**, and copy the value. Remove the spaces when you paste it.
3. Run `setup\7-setup-iis.bat` again and paste the thumbprint. Step 7 then:
   - opens the HTTPS port (8443 by default),
   - redirects every http:// address to https://SERVER-NAME:8443/.
4. Users open `https://SERVER-NAME:8443/`. The name must match the name on the certificate.

If you use a self-signed certificate, each browser shows a warning until the certificate is trusted on every computer. Use a company certificate where possible.

---

## Part 6 - Troubleshooting

| Message or symptom | What to do |
|---|---|
| `Node.js is not installed` (step 1) or `too old` | Install Node.js 22 LTS (Part 1a), open a new window, run step 1 again |
| `URL Rewrite is not installed` / `Application Request Routing is not installed` (step 1 or 7) | Install them as in Part 1c and 1d, then run step 1 or 7 again |
| `The PostgreSQL 16 programs were not found` (step 3) | Install PostgreSQL 16 with the Command Line Tools (Part 1b) |
| `Port 5433 is used by another database` (step 3) | Another program uses 5433. Choose another free port with `KUN_PG_PORT` and never 5432 |
| `The service postgresql-kun-16 did not start` (step 3) | Grant the account `COMPUTERNAME\kunpg` the right *Log on as a service* in `secpol.msc`, then run step 3 again |
| `The database files could not be created` (step 3) | Delete the folder `C:\KUN\pgdata-kun` and run step 3 again |
| `PostgreSQL is not running on port 5433` (step 1, 3 or 4) | Start the service **postgresql-kun-16** in services.msc |
| `could not connect` / `password authentication failed for user "kunmh"` | The `DB_PASSWORD` in `server\.env` does not match user `kunmh`. Run step 4 again with the right password |
| `database "kun_mh" does not exist` | Run step 3 |
| `The KUN MH database cannot use port 5432` (step 1, 3 or 4) | 5432 is the Billing app's database. Use 5433 |
| `The app port and the PostgreSQL port must be different` (step 4) | Choose different ports for the app (3100) and the database (5433) |
| `Port 8080 is already in use by another program` (step 7) | Choose another port in step 7 (not 80, 443, 3000 or 5432) |
| `Port 8080 is in use by the IIS website 'Default Web Site'` (step 7) | Answer *y* to stop that website, or choose another port |
| `The app did not start yet` (step 6) | Read the log lines shown. The usual cause is that the database service is stopped, or the `kunmh` password in `server\.env` is wrong |
| `Port 3100 is already in use` (step 6) | The app is probably running already. Use `stop-app.bat` first, then start it again |
| `IIS answered with status 502` or `500` (step 7 or check-access) | The app is not running. Run `6-start-app.bat`, then check `logs\server.log` |
| `No certificate with thumbprint` (step 7) | Check the thumbprint and that the certificate is in Local Computer > Personal |
| Users see *Loading the shared data* | Reload the page. Check `logs\server.log` for an error |
| Users see *502 Bad Gateway* or an IIS error page | The app is stopped. Run `6-start-app.bat` |
| `pg_dump.exe was not found` (step 8) | Install PostgreSQL 16 with the Command Line Tools, or back up from the app: **Admin > Data > Download backup** |
| *Wrong email or password* in the app | Check the spelling. An administrator can reset the password with the command in Part 3 |

| `psql.exe was not found` (Part 7, step 4) | Install PostgreSQL 16 with the Command Line Tools (Part 1b), then run Part 7, step 4 again |
| `The app is in a user profile folder` (step 7) | IIS cannot read the app there. Move the folder to `C:\KUN\kun-mh` (Part 7, step 1c), then run `6-start-app.bat` and `7-setup-iis.bat` from the new folder |
| Settings show blank job targets, or the job-card priority list still shows *Urgent* | The data upgrade has not run. Run Part 7, step 4 |
| `Could not connect to the database` during the data upgrade | Check that the service `postgresql-kun-16` is running and that the `kunmh` password is right |

When you report a problem, send the text from the script window, the output of `check-access.bat`, and the last lines of `logs\server.log`.

---

## Part 7 - Upgrade an existing installation (version 1.9)

Use this part when KUN MH is already running on a server (for example the hosted copy, last installed from the package of 4 November 2026) and you are bringing it up to version 1.9. The database, the log-ins and the transactions (POs, GRNs, bills, job cards, payments, audit log) stay as they are. Master data is replaced with the 1.9 masters.

**What changes**

| Part | Change in version 1.9 | How it is applied |
|---|---|---|
| Screens (`index.html`) | New screens **Consolidated cash PV** (MH-16B) and **Notifications and pending actions**. Job-card priorities are now *High* and *Normal* only, with targets in days. Bills whose net value is above the received value or the PO value by more than the bill tolerance need variance approval. The default payment mode for new POs is *Cash* | Copy the new files (step 3) |
| Database layout (`server\schema.sql`) | **No change.** No new tables | Nothing to do |
| Server code (`server\src`, `server\client`) | Two new commands for master data (`masters:export`, `masters:import`). The server itself is unchanged | Copy the new files (step 3) |
| Settings and priority list | New settings keys, job-card targets in days, *Urgent* removed | `server\upgrade-1.9.sql` (step 4) |
| Job cards with priority *Urgent* | Become **High** (the closest level that remains). Any that should be *Normal* are changed in the app afterwards | `server\upgrade-1.9.sql` (step 4) |
| Master data: items, vendors, users, price list (MPL), budget lines, categories, lists, access rights, settings | Replaced with the 1.9 masters, from the file `KUN-MH-masters-1.9.json` | Import (step 5) |
| Setup scripts (`setup\`) | Step 7 accepts several allowed networks separated by commas, and refuses an app folder inside a user profile. Step 2 is more tolerant of npm messages. Only needed if you run the scripts again | Copy the new files (step 3) |

**What the master-data import keeps from the hosted database**

- the settings: the approval passphrase, the lock state (*locked* / *unlocked*) and the occupancy plan;
- the password fields of users;
- every transaction, the room status, the number log and the audit log.

Rooms (`m_rooms`) are not part of the master import. Their status keeps changing day by day, so the hosted rooms are kept.

**Before you start**

- Note the folder the app runs from. It must be a permanent folder such as `C:\KUN\kun-mh`, not a folder under `C:\Users\`. If it is under `C:\Users\`, do step 1c first.
- Make sure `psql.exe` is installed (Part 1b). You need the password of the database user `kunmh` (Part 2, step 3).
- Get the file `KUN-MH-masters-1.9.json` from the office. It contains staff names and contact details: keep it on the server only, and do not e-mail it.
- Plan about 30 minutes. Users see an error page while the app is stopped, so do the upgrade outside working hours.

**Steps**

1. **Back up.**
   a. Run `setup\8-backup.bat` and check that the new file in `C:\KUN\backups` is not empty.
   b. Copy the whole `kun-mh` folder to `C:\KUN\kun-mh-before-1.9`. This is the rollback copy.
   c. If the app is under `C:\Users\`, copy the folder to `C:\KUN\kun-mh` and run the remaining steps from there. Then run `6-start-app.bat` and `7-setup-iis.bat` once from the new folder, so that the scheduled task and IIS point to it.
2. **Stop the app.** Double-click `setup\stop-app.bat`.
3. **Copy the new files.** Open a Command Prompt as administrator. Replace `NEW-PACKAGE` with the folder of the new version, and `C:\KUN\kun-mh` with the installed folder:
   ```bat
   robocopy "NEW-PACKAGE\kun-mh" "C:\KUN\kun-mh" /E /XF .env /XD node_modules logs iis
   ```
   This copies `index.html`, the documents, the setup scripts, the server files, `server\upgrade-1.9.sql` and the master-data commands. It keeps `server\.env` (the database settings), `logs`, `iis` and `node_modules`. robocopy exit codes 0 to 7 mean success; 8 or more means an error.
4. **Upgrade the settings and priorities.** In a Command Prompt, in the `server` folder of the installed app:
   ```bat
   cd C:\KUN\kun-mh\server
   "C:\Program Files\PostgreSQL\16\bin\psql.exe" -h 127.0.0.1 -p 5433 -U kunmh -d kun_mh -f upgrade-1.9.sql
   ```
   Type the `kunmh` password when asked (nothing is shown while you type). The script prints:
   - the settings: `job_high_days` 1 and `job_normal_days` 2 (or the values derived from the old targets), `cpv_max` 5000000, `bill_tol` 0.1;
   - `priorities`: `["High", "Normal"]`;
   - no rows at the end, which means no *Urgent* job card is left.
   The script is one transaction: if it stops with an error, nothing is changed. It can also be run again without harm.
5. **Load the master data.** Copy `KUN-MH-masters-1.9.json` to `C:\KUN\masters\`. In a Command Prompt, in the `server` folder:
   ```bat
   cd C:\KUN\kun-mh\server
   npm run masters:import -- C:\KUN\masters\KUN-MH-masters-1.9.json --dry-run
   ```
   The dry run lists each master document as *new*, *changed* or *unchanged*, and saves nothing. Check the list with the Head of Accounts. Then load it for real:
   ```bat
   npm run masters:import -- C:\KUN\masters\KUN-MH-masters-1.9.json
   ```
   The load is one transaction: if it stops with an error, nothing is saved. The last line says *Master data saved*.
5a. **Fix the roles.** The 1.9 master file gives the Sigat members and the Internal Auditors the role Admin. Run `setup\9-fix-roles-1.9.bat` as administrator, with the app stopped. It first shows the four changes (SIGAT1 and SIGAT2 to *Sigat*, TZAKI and TGHADIALI to *Internal Auditor*) and saves them only when you type `Y`. Each change is recorded in the audit log. Users who already have the right role are left alone.
6. **Start the app.** Double-click `setup\6-start-app.bat`, then check that `logs\server.log` ends with `KUN MH server running`.
7. **Check the screens.** From another computer, open the app, log in and check:
   - the menu has **Consolidated cash PV** (under *Bills & payment*) and **Notifications** (under *Admin*);
   - **Settings**, section C, shows *Target - High priority (days)* and *Target - Normal priority (days)*;
   - the job-card priority list shows *High* and *Normal* only;
   - the item, vendor and price-list screens show the 1.9 masters;
   - the existing POs, GRNs, bills and job cards still show their old numbers and dates.
8. **Check the log-ins.** The people on the **Users** screen are the 1.9 masters, but log-ins are kept separately. For each person who needs to sign in to this server, check that an account exists: `npm run user -- list` (in the `server` folder). Add missing ones with `setup\5-create-admin.bat`.
9. **Review the Urgent job cards.** Former *Urgent* job cards are now *High*. Open any that should be *Normal* and change the priority in the app.
10. **Review the settings** with the Head of Accounts (Settings, sections B and C). The 1.9 values for the approval thresholds, the tolerances and the consolidated cash PV limit come from the 1.9 masters.

**Rollback** (if the new version does not work)

1. Stop the app (`setup\stop-app.bat`).
2. Copy the files back from `C:\KUN\kun-mh-before-1.9` into the installed folder, using the same `robocopy` command with the two folders swapped and without `/XF .env`.
3. If the data must be undone too, restore the backup from step 1a: in the app, **Admin > Data > Restore from backup** (see Part 3).
4. Start the app (`setup\6-start-app.bat`).

**Upgrade checklist**

- [ ] Backup made in `C:\KUN\backups`, and the rollback folder copied
- [ ] App folder is not under `C:\Users\`
- [ ] App stopped, new files copied with `robocopy`, `server\.env` kept
- [ ] `upgrade-1.9.sql` ran without errors and printed the expected values
- [ ] Master-data dry run reviewed, then the import saved
- [ ] App started, and `logs\server.log` shows the server running
- [ ] Menu shows *Consolidated cash PV* and *Notifications*
- [ ] Masters checked on the screens; existing transactions unchanged
- [ ] Log-ins checked for each person (step 8)
- [ ] Former *Urgent* job cards reviewed (step 9)
- [ ] Settings reviewed with the Head of Accounts (step 10)

---

## Part 8 - Apply the latest changes to the local server

Use this part to bring an installation that already runs version 1.9 (Part 7) up to the latest changes. It applies to the local server (the office server running the app) and to a copy of the same version. The database layout does not change, and no packages are added. Only the app page and the server code change, so a restart is needed.

**What changes**

| Area | Change | How it is applied |
|---|---|---|
| Screens (`index.html`) | **My desk** home page; **Items & MPL rates** (the MPL is on the Items page, and its menu entry is removed); **Log out** button in the header (server mode); GRN **No PO** option; typed items on PO lines, with new items added to the item master | Copy the file (step 3) |
| Server (`server\src\server.js`) | Sign-in locked for 30 seconds after three wrong passwords; Admin can set a temporary log-in password for a linked user; users can change their own password; each change is recorded in the audit log | Copy the file, then restart the app (step 5) |
| Users (`index.html`) | **My account** button in the header: shows the person's details, changes their own password, and signs out | Copy the file (step 3) |
| Access rights (`index.html`) | Table **Who may create records**: choose which roles may create purchase orders, GRNs, bills, issue slips, job cards, laundry hand-overs and consolidated PVs. Admin always may | Copy the file (step 3). Existing rights are kept |
| Notifications (`index.html`) | **Copy for e-mail** and an **E-mail** link on each pending notice | Copy the file (step 3) |
| Roles | Sigat members and Internal Auditors set to their own role | Part 7, step 5a (once; skip if done) |
| Vendor names | The 58 vendors whose names were in Arabic are now in English, with every saved reference changed. Vendor names must be in English letters | `setup\10-vendor-names-english.bat` (step 4a, once) |
| Budget codes | MT-01 to MT-05, HK-01 and HK-02 become one line **MT**; new line **SR**; service and labour categories move to SR; the HK item codes become ITM codes (HK-001 is now ITM-001) | `setup\11-budget-merge-1.9.bat` (step 4b, once) |

No data needs converting. The new access rights default to the existing page rights. Existing GRNs and POs are not changed.

**Before you start**

- Make sure you have a backup from the last upgrade, or make one now: run `setup\8-backup.bat`.
- Note that the sign-in lock-out is held in the server's memory. It clears when the app restarts, so a user who was locked can sign in again after a restart.
- Two people may be working in the app during the update. Tell them to save their work and log out first.

**Steps**

1. **Stop the app.** Double-click `setup\stop-app.bat` (or run it from the installed folder).
2. **Copy the new files.** From the new package (or from this computer's repository folder), replace `NEW-PACKAGE` with that folder and `C:\KUN\kun-mh` with the installed folder:
   ```bat
   robocopy "NEW-PACKAGE\kun-mh" "C:\KUN\kun-mh" /E /XF .env /XD node_modules logs iis
   ```
   Robocopy exit codes 0 to 7 mean success.
3. **Check the files.** `C:\KUN\kun-mh\index.html` and `C:\KUN\kun-mh\server\src\server.js` should now have the date of the new package.
4. **Check the packages.** Nothing new is installed. If you are unsure, run `npm install` once in `C:\KUN\kun-mh\server`.
4a. **Vendor names (once).** Run `setup\10-vendor-names-english.bat` as administrator, with the app stopped. It shows the 58 renames first and saves them only when you type `Y`. It writes a backup to the `backups` folder first. Check the new names with the Head of Accounts: names marked (2) may be duplicates of existing vendors, and should be merged in Vendors if they are the same vendor. Skip this step if the names are already in English (the script then reports nothing to rename).
4b. **Budget codes and item codes (once).** Run `setup\11-budget-merge-1.9.bat` as administrator, with the app stopped. It shows the change first and saves it only when you type `Y`, after writing a backup. If it reports that the old budget lines were not found, the change is already made: skip this step.
5. **Start the app.** Double-click `setup\6-start-app.bat`, then check that `logs\server.log` ends with `KUN MH server running`.
6. **Roles (once).** If the Sigat members and Internal Auditors still show the role Admin, run `setup\9-fix-roles-1.9.bat` as administrator and type `Y` when asked. Skip this step if the roles are already correct.
7. **Check the screens.** Sign in from another computer and check:
   - the menu has **My desk** (first in the *Overview* group) and **Items & MPL rates**, with no separate *Master price list* entry;
   - the header shows **My account** and **Log out**;
   - on **Notifications**, each pending notice has **Copy for e-mail**;
   - on **Access rights**, the table **Who may create records** is shown below the page rights;
   - on **Purchase orders**, the item lines accept a typed item name;
   - on **Goods receipt notes**, the PO dropdown has **No PO**.
8. **Check the password tools.** As the Head of Accounts, open a linked user from **Users**: the dialog shows **Reset log-in password**. Do not reset a real user's password as a test; use a temporary test log-in if you need to try it.

**Rollback** (if the new version does not work)

1. Stop the app (`setup\stop-app.bat`).
2. Copy the files back from the backup folder (`C:\KUN\kun-mh-before-1.9`, or the folder you copied before this update), using the same `robocopy` command with the two folders swapped and without `/XF .env`.
3. Start the app (`setup\6-start-app.bat`).

**Local server checklist**

- [ ] Backup made (`setup\8-backup.bat`)
- [ ] Users told to save and log out
- [ ] App stopped, new files copied with `robocopy`, `server\.env` kept
- [ ] App started, and `logs\server.log` shows the server running
- [ ] Menu, header and access-rights checks done (step 7)
- [ ] Roles checked, or Part 7, step 5a run (step 6)
- [ ] Vendor names checked, or step 4a run
- [ ] Budget codes merged (MT, SR, ITM), or step 4b run; Budget and Items checked

---

## Security checklist

- [ ] Only IIS (ports 8080 and 8443) is reachable from the network. Ports 3100 and 5433 are closed to the network (`check-access.bat` confirms).
- [ ] The firewall rules allow only the office network (step 7, first question), not *Any*.
- [ ] HTTPS is in use (Part 5), with a certificate from the company certificate authority.
- [ ] The KUN MH database (port 5433, service `postgresql-kun-16`) is separate from the Billing database (port 5432). Its passwords are not shared with the Billing app.
- [ ] `server\.env` is not shared, emailed or copied. It contains the database password.
- [ ] Each person has their own account, and leavers are disabled promptly.
- [ ] Backups are made weekly and kept on another drive or server.
- [ ] The server is patched by IT, and the folders `kun-mh\logs` and `C:\KUN\backups` are not shared.

---

## Installation checklist

- [ ] Node.js 22 LTS checked (Part 1a)
- [ ] PostgreSQL programs present, Billing database untouched (Part 1b)
- [ ] URL Rewrite 2.1 installed (Part 1c)
- [ ] Application Request Routing 3.0 installed (Part 1d)
- [ ] HTTPS certificate thumbprint noted (Part 1e), or decided to add it later
- [ ] Server name added to DNS or known to the office network (Part 1f)
- [ ] Step 1 passed with no FAIL lines
- [ ] Step 2 finished (packages installed)
- [ ] Step 3 finished (KUN MH database cluster created, database and user created)
- [ ] Step 4 finished (connection tested)
- [ ] Step 5 run for each person
- [ ] Step 6 finished (app running in the background)
- [ ] Step 7 finished (IIS test passed)
- [ ] `check-access.bat` reports no failed check
- [ ] The app opens from another computer, and the first log-in works
- [ ] First set-up completed (example or empty data)
- [ ] Step 8 made the first backup
- [ ] The server was restarted once, and the app and database came back by themselves
- [ ] Existing installation only: the upgrade checklist in Part 7 is complete
