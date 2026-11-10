# KUN MH remediation status

Status of every item in `KUN-MH-gap-analysis.md` (IDs A, D, F, U, section 3.5) and every finding in
`KUN-MH-app-analysis.md` (section 12, findings 1–12, and section 13 open items), checked against the code on
branch `remediation/phases-1-3`. Tests: `cd server && npm test` (45 passing).

Status words: **Done** (in the code and tested) · **Done (verified in browser)** · **Partly** · **Not done** ·
**Operator** (data or setup on the live system, needs the Head of Accounts) · **Decision** (needs a yes/no).

## Gap analysis: access and security (A)

| ID | Gap | Status | Where / note |
|---|---|---|---|
| A1 | Four people hold the Admin role | **Operator** | Script ready and tested: `npm run roles:fix-1.9 -- --dry-run`, then apply. Not applied: the live database rejected the stored password, and it needs sign-off |
| A2 | Access enforced only in the browser | **Done (writes and reads)** | `server/src/permissions.js`, checked in `server/src/app.js`. Reads: a restricted collection comes back empty for a role that cannot see any page using it (checked in the browser as the HK Supervisor: no bills shown, no errors). Always readable: settings and lists, the user list, the item master, rooms and the logs (see Limits) |
| A3 | Reset and restore are destructive | **Done (typed word + count)**; named-person rule **Decision** | `typedConfirm` in `index.html`: type RESET / RESTORE; shows the record count. Still Admin-only |
| A4 | No sign-in lock-out | **Partly** | 3 wrong passwords = 30 s pause, per email (already there). Per-address limit **not added**: behind IIS every request comes from 127.0.0.1, so it would lock everyone out. Lock-out is in memory, so it resets on restart |
| A5 | Session cookie not Secure | **Done (switch on with HTTPS)** | `COOKIE_SECURE=true` adds `Secure`. Turn on once IIS serves HTTPS |
| A6 | Sign-ins not in audit log | **Done** | Successful and failed log-ins written; the password is never logged |
| A7 | Users not linked to a sign-in | **Operator** | `npm run user`, then link in the app |
| A8 | Shared contact address | **Operator** | Give each person their own contact |

## Gap analysis: data (D)

| ID | Gap | Status | Where / note |
|---|---|---|---|
| D1 | Example room list (120 rooms) | **Operator** | Import the real room list (Data page) |
| D2 | All 179 vendors approved, no bank details | **Operator** | Verify bank details from each vendor's letter; remove AVL where not confirmed. The app blocks payment without a verified record (see F1) |
| D3 | Budgets are zero | **Operator** | Enter annual budgets in Settings section E (unlock with the approval password) |
| D4 | MPL is a draft | **Operator** | Enter quoted rates with vendors, then approve |
| D5 | No HK norms or linen par | **Operator** | Set in Items |
| D6 | Re-order levels look like a placeholder (5) | **Operator** | Confirm each re-order level |
| D7 | Stock count not done | **Operator** | Month-end count |
| D8 | 44 past bills fail the 3-way match but are Clear | **Operator** review | The app blocks marking a new bill Clear when the match fails (`ACT.auditBill`); existing records need review |
| D9 | Six duplicate invoice numbers | **Operator** review | Check for double payment |
| D10 | 17 bills of 500,000 IQD or more have no PO | **Operator** review | Record the reason for each |
| D11 | GRN data incomplete (one number for three lines) | **Operator** | Correct or cancel those lines |
| D12 | Provenance of transactions unclear | **Operator** | Record which source each transaction came from |
| D13 | PO 0001 is an empty stub | **Done (cancelled on the training copy)**; live copy **Operator** | Cancel with a reason using the PO's Cancel option (tested on the training copy with PO 0001 and 0002) |
| D14 | Actual zaereen-days not entered | **Operator** | Enter each month's actuals |
| D15 | Hosted server copied the same roles | **Operator** | As A1, on the hosted server |

## Gap analysis: flow and functionality (F)

| ID | Gap | Status | Where / note |
|---|---|---|---|
| F1 | End-to-end flow not proven | **Partly (verified in browser on the training copy)** | Run: vendor approved → PO issued and approved (budget check OK) → GRN (200 received, PO balance 0) → bill matched to the GRN → audit. The audit gate worked: a bill with an unticked bank-check line could not be Cleared, and was set to Query. **Not run:** payment and cash PV (need a verified vendor bank record) |
| F2 | PO number issued before the PO is filled | **Done (mitigated)** | Empty POs can be cancelled with a reason. A draft without a number was not built, because it changes numbering rules |
| F3 | Bill can be Clear with a failed 3-way match | **Partly** | UI blocks it (`ACT.auditBill`) and it was checked in the browser. No server-side check, because the server does not compute the match |
| F4 / U2 | Dashboard and registers disagree | **Done (for bills on hold)** | "Bills on hold / query" uses the register's rule (checked: dashboard and register both show 1). Other counts already come from one computed set |
| F5 | Notices not sent by e-mail | **Decision** | In-app only today. Add an e-mail service only if people outside the app must be told |
| F6 | Budget warnings cannot work | **Operator** | Follows D3 |
| F7 | Issue slips not tested | **Not run** | Needs counted stock and a job card |
| F8 | No automated tests | **Partly** | 45 tests: permissions, route security, role-fix script, calculation rules (`rules.js`, boundary values). Not yet: import (dry run) and the page's screens (checked by hand in the browser) |

## Gap analysis: user interface (U)

| ID | Gap | Status | Where / note |
|---|---|---|---|
| U1 | Exception 18 mislabelled | **Done (verified)** | Dashboard shows "Stock items at or below re-order level" (56) and "Negative stock / count differences" (0) |
| U2 | Dashboard and registers disagree | See F4 | |
| U3 | Empty pages give no first step | **Done (verified)** | `EMPTY_HINT` in `index.html`, nine pages |
| U4 | PO page says "cancel with a reason" but there is no cancel | **Done (verified)** | Existing Cancel checkbox, remarks required, number kept |
| U5 | Access page says "Admin always has full access" | **Done (verified)** | Wording corrected; Admin column fixed; three pages view-only for Admin |
| U6 | Guide not linked to the pages | **Done (verified)** | Each step name opens its page |

## Gap analysis: hosted server (section 3.5)

| Item | Status | Note |
|---|---|---|
| Same roles, vendors, budgets, room list as local | **Operator** | Same steps as A1, D1–D3 on the hosted server |

## App analysis: findings 1–12 and open items

| # | Finding | Status | Note |
|---|---|---|---|
| 1 | Access enforced only in browser (High) | **Done (writes and reads)** | See A2 |
| 2 | No sign-in lock-out or rate limit (Medium) | **Partly** | See A4 |
| 3 | Session cookie not Secure (Medium) | **Done (switch on with HTTPS)** | See A5 |
| 4 | Live updates work only with one server process (Medium) | **Done (code and unit tests)** | Each change is sent as a PostgreSQL NOTIFY on `kun_mh_changes`. Every process LISTENs (`server.js`, reconnects if dropped) and passes it to its own browsers. Tested: a notice from another process reaches the browser stream. **Not yet run on two live processes**: needs a working database |
| 5 | No e-mail notices (Low) | **Decision** | See F5 |
| 6 | Reset and restore destructive (Medium) | **Partly** | Typed confirmation and count added. Admin-only; the named person is a **Decision** |
| 7 | Access rights and users from the master import (Medium) | **Operator** | Review the Access page after each import (A1, D15) |
| 8 | In-app user list and server accounts are separate (Medium) | **Operator** | Keep both lists in step (A7) |
| 9 | Backups contain all business data and staff details (Medium) | **Done** | The backup keeps the business records and leaves out staff e-mail, phone and similar fields (`KUNRules.stripStaffContacts`, tested). Only the Admin can open the Data page, and each download is audited. Store backup files on a restricted share (operator) |
| 10 | No automated tests (Medium) | **Partly** | See F8 |
| 11 | Install guide shows PostgreSQL 16 paths; hosted uses 18 (Low) | **Not done** | Needs the hosted version checked first, then both paths shown in the guide |
| 12 | Mobile layout not verified (Low) | **Done (checked at 390 px, all 29 pages)** | Headless Chromium at 390 px (`server/testing/phone-check.py`): no page scrolls sideways. Import page fixed (two-column layout, wrapping buttons and tags). Wide tables scroll inside their own box, by design |
| §13 | Access rights on the hosted server after import | **Operator** | See A1, D15 |
| §13 | Reset and restore behaviour per role | **Partly** | Reset and restore are Admin-only in the code; not tested per role |
| §13 | Mobile and touch | **Partly** | Layout checked at 390 px (finding 12). Touch behaviour (taps, long lists) not tested on a device |
| §13 | Bill tolerance (1.9) on real bills | **Operator** | Test with real bills |
| §13 | Sign-in with each person's account on the hosted server | **Operator** | After A7 |

## Downloads copy (`KUN Maintenance Control (Copy)`)

| Item | Status | Note |
|---|---|---|
| Password field in exports | **Done** | Backup export drops password hashes |
| Personal e-mails in seed | **Done** | User e-mails cleared; backup kept outside the project |
| Store Keeper role has no users or page | **Decision** | Keep it (and add a user and page) or remove it |
| Align page list with 1.9 | **Partly** | Copy is a 26-page version with its own design; left as is, mark as training-only |
| Rebuild `dist` zip packages | **Done** (see below) | Rebuilt from committed code, without `.env`, `node_modules` or logs |

## Limits

- **Reads are restricted by page, with exceptions.** Always readable: the settings and lists (the app needs the thresholds in the browser), the user list (names and the signed-in user's link), the item master, rooms, and the audit, notice and number logs. A role that can see any page using a collection can read it; for example the GRN Officer can read bills, because the PO Register shows the billed amount.
- **Local test server** (`server/testing/dev-server.js`): in-memory database and a log-in bypass (`devUser`) for trying screens as Admin. Never the live system. The production entry point never sets the bypass.
- **Live PostgreSQL** (port 5433) rejected the stored password during this work, so no live database step was run.
- **Training data** created during the chain test (vendor V-0001 approved with a placeholder bank value, an approval password, a budget of 20,000,000 for MT, PO 0003 and its GRN and bill) exists only in the in-memory test server. Nothing was written to the live system.

## Version 2.2 (applied)

| Item | Status | Note |
|---|---|---|
| Store Keeper role (eighth role) and the version 2.2 access matrix | **Done** | Rights for all eight roles on every page; tested |
| Internal Auditor edit rights on Users and Access (from version 2.2) | **Applied, review** | Set to H on the Access rights page if not wanted |
| Store Keeper acts as GRN Officer where checked by name | **Done** | `ROLE_BASE` in `index.html` |
| Items edit follows the access matrix | **Done** | Already the behaviour of the server version |
| Bill line items | **Done (data and read-only page)** | Kept on each bill; new Bill lines page (32 lines in the data) |
| Item approval fields (apprBy, apprOn, appr) | **Done** | Kept on each item |
| Bill Lines page | **Done** | Read only; entry stays on the Bills page |
| Import page | **Already present** | The earlier list was wrong: the server version has it |
| vcol table style | **Done** | Applied to the access-matrix role columns |
| Title and version label | **Done** | Version 2.2 in the settings and the page data |
| 20-role limit | **Not done** | The server has a fixed role list. Needs a decision: a role table that the Access, Users and permission code read at run time |
| Rooms | **Operator** | Version 2.2 has no room list; import the real one (Data page) |
| Notice recipients (version 2.2 `notifyMap`) | **Not applied** | The server version has its own notice rules; needs a review of both lists |
