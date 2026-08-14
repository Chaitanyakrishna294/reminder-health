-- Validation for migration_notification_targets_2026_08_14.sql
--
-- ONE query — the Supabase editor shows only the last statement's result, so
-- separate SELECTs would hide every check but the final one.
--
-- Check 5 is the one that matters. Catalog checks prove the COLUMNS exist; only
-- reading the compiled function body proves the trigger actually fills them, and
-- plpgsql compiles on first execution, so a body that throws still passes every
-- structural check here. Check 6 is the real call.
-- ============================================================================

WITH cols AS (
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'notifications'
),
fn AS (
  SELECT p.oid, pg_get_functiondef(p.oid) AS def, p.proacl
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'handle_reminder_event_state_change'
),
fk AS (
  SELECT c.confdeltype
  FROM pg_constraint c
  WHERE c.conrelid = 'public.notifications'::regclass
    AND c.contype = 'f'
    AND EXISTS (
      SELECT 1 FROM unnest(c.conkey) k
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k
      WHERE a.attname = 'medication_id'
    )
)

SELECT 1 AS chk, 'medication_id exists and is nullable' AS what,
       coalesce((SELECT data_type || ' / nullable=' || is_nullable FROM cols WHERE column_name = 'medication_id'), 'MISSING') AS observed,
       CASE WHEN (SELECT is_nullable FROM cols WHERE column_name = 'medication_id') = 'YES'
            THEN 'DONE' ELSE 'FAIL' END AS verdict

UNION ALL
SELECT 2, 'scheduled_for exists, is timestamptz and nullable',
       coalesce((SELECT data_type || ' / nullable=' || is_nullable FROM cols WHERE column_name = 'scheduled_for'), 'MISSING'),
       CASE WHEN (SELECT data_type FROM cols WHERE column_name = 'scheduled_for') = 'timestamp with time zone'
             AND (SELECT is_nullable FROM cols WHERE column_name = 'scheduled_for') = 'YES'
            THEN 'DONE' ELSE 'FAIL' END

UNION ALL
-- SET NULL, not CASCADE. Deleting a medication must never erase the record that
-- something happened — the same rule reminder_logs and reminder_events follow.
SELECT 3, 'medication_id FK is ON DELETE SET NULL',
       coalesce((SELECT CASE confdeltype WHEN 'n' THEN 'SET NULL' WHEN 'c' THEN 'CASCADE'
                                         WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
                                         ELSE confdeltype::text END FROM fk), 'NO FK'),
       CASE WHEN (SELECT confdeltype FROM fk) = 'n' THEN 'DONE' ELSE 'FAIL' END

UNION ALL
-- The ACL must survive. CREATE OR REPLACE keeps it; a DROP+CREATE would reset it
-- to PUBLIC EXECUTE, which is how this repo has re-opened functions before.
SELECT 4, 'trigger function acl is set (not reset to PUBLIC)',
       coalesce((SELECT proacl FROM fn)::text, 'NULL (= PUBLIC!)'),
       CASE WHEN (SELECT count(*) FROM fn) = 1
             AND NOT has_function_privilege('anon', (SELECT oid FROM fn), 'EXECUTE')
            THEN 'DONE' ELSE 'FAIL' END

UNION ALL
-- Eleven INSERTs, eleven pairs. A count short means one branch still writes a
-- notification with no target — and it would be the rarest branch that broke,
-- which is the one nobody would notice.
SELECT 5, 'all 11 notification inserts carry the dose identity',
       (SELECT (length(def) - length(replace(def, 'NEW.medication_id, NEW.scheduled_for', '')))
               / length('NEW.medication_id, NEW.scheduled_for') FROM fn)::text || ' of 11',
       CASE WHEN (SELECT (length(def) - length(replace(def, 'NEW.medication_id, NEW.scheduled_for', '')))
                         / length('NEW.medication_id, NEW.scheduled_for') FROM fn) = 11
            THEN 'DONE' ELSE 'FAIL' END

UNION ALL
-- COMPILE PROBE + END-TO-END. Resolving a dose fires this trigger; if the body
-- does not compile, or a column name is wrong, this is where it shows. Reads the
-- most recent dose notification and asks whether it knows its own dose.
--
-- INFO rather than FAIL when there is nothing to read: on a quiet database no
-- dose has been answered since the migration, and "no rows yet" is not a
-- failure. Answer one dose in the app and re-run.
SELECT 6, 'newest dose notification since the migration knows its dose',
       coalesce((
         SELECT 'type=' || n.type
                || ' med=' || coalesce(n.medication_id::text, 'NULL')
                || ' sched=' || coalesce(n.scheduled_for::text, 'NULL')
         FROM public.notifications n
         WHERE n.type IN ('TAKEN', 'SKIPPED', 'UNCONFIRMED', 'ESCALATED')
         ORDER BY n.created_at DESC
         LIMIT 1
       ), 'no dose notifications yet — answer a dose and re-run'),
       CASE
         WHEN NOT EXISTS (SELECT 1 FROM public.notifications
                          WHERE type IN ('TAKEN','SKIPPED','UNCONFIRMED','ESCALATED'))
           THEN 'INFO (none yet)'
         WHEN (SELECT medication_id FROM public.notifications
               WHERE type IN ('TAKEN','SKIPPED','UNCONFIRMED','ESCALATED')
               ORDER BY created_at DESC LIMIT 1) IS NOT NULL
           THEN 'DONE'
         ELSE 'INFO (newest row predates the migration — answer a dose and re-run)'
       END

UNION ALL
-- INFO. These are the rows that keep the created_at approximation forever, by
-- design. A large number here is expected and is not a problem to solve.
SELECT 7, 'INFO — dose notifications on the old approximation',
       (SELECT count(*)::text FROM public.notifications
        WHERE type IN ('TAKEN','SKIPPED','MISSED','ESCALATED','UNCONFIRMED')
          AND medication_id IS NULL) || ' row(s)',
       'INFO'

UNION ALL
-- INFO. Care-circle rows route by connection_id, which they have always had.
SELECT 8, 'INFO — care-circle rows carrying a connection_id',
       (SELECT count(*) FILTER (WHERE connection_id IS NOT NULL)::text || ' of '
             || count(*)::text
        FROM public.notifications WHERE type LIKE 'CARE_CIRCLE%'),
       'INFO'

ORDER BY chk;
