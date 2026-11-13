-- KUN Maintenance & Housekeeping - data upgrade to version 1.9 (for an installation made from the earlier package).
--
-- Run this ONCE on the existing database `kun_mh` after the new index.html is in place (see UPGRADE-HISTORY.md, section 1).
-- It is safe to run again: every change only adds a missing key or removes the Urgent priority.
-- It changes NO transactions (POs, GRNs, bills, job cards, ...). It does not change the table layout (schema.sql is unchanged).
-- Config documents keep their values under the key "v" (cfg/settings, cfg/lists, ...), which is why the queries use data->'v'.
--
-- How to run (in a Command Prompt, from the server folder; the user is kunmh):
--   "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h 127.0.0.1 -p 5432 -U kunmh -d kun_mh -f upgrade-1.9.sql
-- Take a backup first (setup\8-backup.bat) and stop the app first (setup\stop-app.bat).

BEGIN;

-- 1. Settings added or changed in version 1.9.
--    Job-card targets are now in days (High and Normal); they are derived from the old hour targets when present.
--    Other new settings get their default only when they are missing. Existing values are never overwritten.
UPDATE kv_docs
   SET data = jsonb_set(data, '{v}',
         jsonb_build_object(
           'jobHighDays',   COALESCE(CEIL(((data->'v')->>'slaHighH')::numeric / 24), 1),
           'jobNormalDays', COALESCE(CEIL(((data->'v')->>'slaNormalH')::numeric / 24), 2))
         || '{"cpvMax": 5000000, "billTol": 0.1, "priceTol": 0.1, "maxAdv": 0.3, "budgetWarn": 0.9,
              "hkTol": 0.1, "masoolLimit": 5000000, "masoolHoaLimit": 25000000}'::jsonb
         || (data->'v'))
 WHERE coll = 'cfg' AND id = 'settings' AND jsonb_typeof(data->'v') = 'object';

-- 2. The Urgent priority was removed (only High and Normal remain).
UPDATE kv_docs
   SET data = jsonb_set(data, '{v,priorities}', '["High", "Normal"]'::jsonb)
 WHERE coll = 'cfg' AND id = 'lists' AND (data->'v'->'priorities') ? 'Urgent';

-- 3. Job cards with the Urgent priority become High (the closest level that remains).
--    Those cards can then be changed to Normal in the app if needed.
UPDATE kv_docs
   SET data = replace(data::text, '"priority": "Urgent"', '"priority": "High"')::jsonb
 WHERE data::text LIKE '%"priority": "Urgent"%';

COMMIT;

-- 4. Checks (read only). Expected: the four job/billing values are set, lists.priorities = High, Normal,
--    and the last query returns no rows.
SELECT data->'v'->>'jobHighDays'   AS job_high_days,
       data->'v'->>'jobNormalDays' AS job_normal_days,
       data->'v'->>'cpvMax'        AS cpv_max,
       data->'v'->>'billTol'       AS bill_tol
  FROM kv_docs WHERE coll = 'cfg' AND id = 'settings';
SELECT data->'v'->'priorities' AS priorities FROM kv_docs WHERE coll = 'cfg' AND id = 'lists';

-- 5. Check (read only): this must return no rows.
SELECT coll, id FROM kv_docs WHERE data::text LIKE '%"priority": "Urgent"%';
