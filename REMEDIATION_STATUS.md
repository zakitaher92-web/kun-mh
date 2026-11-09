# KUN MH remediation status

Status of each gap from `KUN-MH-gap-analysis.md`, checked against the code on branch `remediation/phases-1-3`
(commits 94d1b11 to 42055f7). Tests: `cd server && npm test` (37 passing).

| ID | Gap | Status | Where / note |
|---|---|---|---|
| A1 | Four people with Admin role | Tool ready, **not applied** | `npm run roles:fix-1.9 -- --dry-run` (tested). Live database was not reachable (password rejected), and the change needs Head of Accounts sign-off |
| A2 | Access enforced only in browser | **Done for writes** | `server/src/permissions.js`, enforced in `server/src/app.js`. Reads stay open: the app loads its working set on start (see below) |
| A3 | Reset and restore destructive | **Done (typed word + count)** | `index.html` `typedConfirm`: type RESET / RESTORE; shows record count. Still Admin-only; "one named person" needs a decision |
| A4 | No sign-in lock-out | Partly | Lock after 3 wrong passwords for 30 s, per email (existed). Per-address limit **not added**: behind IIS all requests come from 127.0.0.1 |
| A5 | Cookie not Secure | **Done (switch-on)** | `COOKIE_SECURE=true` adds `Secure`. Turn on when IIS serves HTTPS |
| A6 | Sign-ins not in audit log | **Done** | Successful and failed log-ins written; password never logged |
| A7 | Users not linked to sign-in | Operator | Create accounts with `npm run user`, then link in the app |
| A8 | Shared contact address | Operator | Give each person their own contact |
| D1 | Example room list | Operator | Import real room list |
| D2 | Vendors all AVL, no bank details | Operator | Verify, remove AVL where not confirmed |
| D3 | Budgets zero | Operator | Enter annual budget lines |
| D4 | MPL is draft | Operator | Enter quoted rates, approve |
| D5 | No HK norms / linen par | Operator | Set in Items |
| D7 | Stock count not done | Operator | Month-end count |
| D8 | 44 bills fail 3-way match but are Clear | Operator review | UI already blocks Clear on a failed match (`ACT.auditBill`). Existing bills need review |
| D9 | Duplicate invoice numbers | Operator review | Check for double payment |
| D13 | PO 0001 empty stub | Operator | Use the existing Cancel option on the PO (requires remarks) |
| D14 | Actual occupancy missing | Operator | Enter monthly actuals |
| D15 | Hosted server copied roles | Operator | As A1 on hosted server |
| F1 | End-to-end flow not proven | **Not run** | Needs a working database and a training copy |
| F2 | PO number issued before PO filled | Mitigated | Cancel with reason exists. Draft-without-number not built (changes numbering rules) |
| F3 | Clear allowed on failed match | Mostly | UI guard exists. No server-side guard (server does not compute the match) |
| F4 / U2 | Dashboard and registers disagree | Partly | "Bills on hold / query" now uses the register's rule. Other counts already share one computed set |
| F5 | No e-mail notices | Accepted | In-app only, as designed |
| F6 | Budget warnings | Operator | Follows D3 |
| F7 | Issue slips not tested | **Not run** | Needs stock and job cards |
| F8 | No automated tests | Partly | 37 tests: permissions, route security, role fix. Calculation rules in `index.html` are **not** tested yet: they must first move into a module |
| U1 | Exception 18 mislabelled | Already correct | Counts negative stock and count differences |
| U3 | Empty pages with no guidance | **Done** | `EMPTY_HINT` in `index.html` (nine pages) |
| U4 | PO has no cancel | Already present | Cancel checkbox; remarks required |
| U5 | Access text wrong | **Done** | Wording corrected |
| U6 | Guide not linked to pages | **Done** | Step names link to their pages |
| Copy | Downloads copy: password field and e-mails | **Done** | Backup export drops password hashes; seed user e-mails cleared (backup kept outside the project) |
| Copy | Store Keeper role has no users or page | **Decision needed** | Left as is |
| Copy | Rebuild `dist` zip packages | **Not done** | Do at release |

## Limits

- **Reads are open to any signed-in user.** The app keeps its full working set in the browser, so restricting reads would break the start-up. Fixing this needs the app to load only what each page needs.
- **Local test server** (`server/testing/dev-server.js`): in-memory database and log-in bypass (`devUser`). For trying the screens only. Never used for the live system; the production entry point never sets the bypass.
- The live PostgreSQL on port 5433 rejected the stored password during this work, so no database step was run.
