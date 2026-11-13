# KUN MH - hosted site (Vercel) and the move to tables

The hosted site is this folder deployed to Vercel. `api\index.js` runs the same Express app as the office server, against a **Neon** PostgreSQL database. Vercel serves the site over HTTPS. The hosted site and the office server are separate installations: changing one does not change the other.

The office server is described in [INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md).

---

## A. Deploy

- **Production:** from this folder, `vercel --prod --yes`.
- **Preview** (to test a change first): `vercel --yes`. Preview deployments are protected by Vercel Deployment Protection.
- **Check the deployment:** the command prints the URL and *ready*. Open it, log in, and check one list.
- **Roll back a bad release:** `vercel rollback`, or the previous deployment in the Vercel dashboard. This restores the code only, not the data.

**Environment settings** (in the Vercel project, through the dashboard or `vercel env`). Never write a value into the repository, a README or an e-mail:

| Name | Production | Preview | Meaning |
|---|---|---|---|
| `DATABASE_URL` | the production Neon database | a separate test database | Connection string (secret) |
| `DB_SSL` | `require` | `require` | TLS for Neon |
| `COOKIE_SECURE` | `true` | `true` | Session cookie only over HTTPS |
| `DATA_MODE` | `tables` after the cutover in section C (`kv` before) | the same as production, or `kv` for a test | Which data layout the app uses |
| `TZ` | `Asia/Baghdad` | `Asia/Baghdad` | Time zone of the server's dates (audit log times). Without it, Vercel uses UTC |

Keep the preview `DATABASE_URL` pointing at a database that is not production.

**Time zone.** The page computes business dates in Asia/Baghdad time, the same as the office server (version 2.2.0). The server's own dates (audit log times) follow `TZ`. Set `TZ=Asia/Baghdad` in Vercel, so that the times in the audit log match the office. Check after the next deployment: a new audit entry must show Baghdad time.

---

## B. Hosted database: kv or tables

The hosted database runs in one of two layouts, chosen by `DATA_MODE`:

- `kv` (the original): documents in `kv_docs`, one row per document.
- `tables`: the relational tables from `server\schema-tables.sql`, with line tables and typed columns. The browser still receives the same documents.

Tables mode is switched on only after the cutover below is done. Run every command in the `server` folder, in PowerShell, with the production URL set only in your own session. Do not paste it into chat, a file or a ticket.

---

## C. Cutover to tables

**Before the cutover**

1. **Restore point.** In the Neon console, create a branch of the production database, named for the date. Or run `pg_dump -Fc` against the production URL and keep the file somewhere safe.
2. **Freeze writes.** Tell users to stop saving until you say so. Keep the freeze until step 7 is complete.

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
- **After step 6:** set `DATA_MODE=kv` for Production and redeploy. Records saved while the site ran in tables mode are not in `kv_docs`, so first copy the tables back with `node src/migrate-tables-to-kv.js` (dry run), then with `--apply --confirm-target <HOST/DB>`. The copy keeps a backup of `kv_docs` in a table named `kv_docs_backup_<time>`.
- **Last resort:** restore the restore point from step 1.

**Warning.** The copy back to `kv_docs` (`migrate:kv`) has been dry-run tested against the preview database, but its apply step has not yet been rehearsed on a copy of the database. Rehearse it on a copy before you rely on it for a rollback.
