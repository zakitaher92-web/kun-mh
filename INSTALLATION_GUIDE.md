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
  1. **Which computers may open the app.** Press Enter for *LocalSubnet* (computers on the same network as the server). Type a range such as `10.10.0.0/16` if the office uses several networks. Ask IT if you are not sure.
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

When you report a problem, send the text from the script window, the output of `check-access.bat`, and the last lines of `logs\server.log`.

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
