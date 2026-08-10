-- VALIDATION for migration_anonymous_guests_2026_08_10.sql
-- Run in the Supabase SQL Editor AFTER applying the migration.

-- 1. Predicate exists and is STABLE.
SELECT
  CASE WHEN p.provolatile = 's' THEN 'PASS — is_anonymous_user() present and STABLE'
       ELSE 'FAIL — wrong volatility: ' || p.provolatile END AS check_1_predicate
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'is_anonymous_user';

-- 2. In the SQL editor there is no JWT, so this MUST be false. If it ever
--    returns true here, the COALESCE default is wrong and the guard would be
--    blocking the Render worker and every maintenance query.
SELECT
  CASE WHEN public.is_anonymous_user() = false
       THEN 'PASS — no-JWT context reads as NOT anonymous'
       ELSE 'FAIL — would block service_role and SQL editor writes' END AS check_2_default;

-- 3. Both triggers attached, BEFORE INSERT, ROW level.
SELECT
  CASE WHEN count(*) = 2 THEN 'PASS — both guest guards attached'
       ELSE 'FAIL — found ' || count(*) || ' of 2' END AS check_3_triggers
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
WHERE NOT t.tgisinternal
  AND t.tgname IN ('guard_guest_write_caregiver_connections', 'guard_guest_write_health_records')
  AND c.relname IN ('caregiver_connections', 'health_records');

-- 4. The guard is NOT attached to the tables a guest is supposed to use. A hit
--    here means someone widened the gate and guests can no longer try the app.
SELECT
  CASE WHEN count(*) = 0 THEN 'PASS — medications/doses left open to guests'
       ELSE 'FAIL — guard wrongly attached to ' || string_agg(c.relname, ', ') END AS check_4_not_overreaching
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
WHERE NOT t.tgisinternal
  AND t.tgfoid = 'public.guard_guest_write'::regproc
  AND c.relname IN ('medications', 'reminder_events', 'reminder_logs', 'profiles', 'medical_profiles');

-- 5. A real INSERT still works from a no-JWT context (proves the guard does not
--    block the Render worker). Rolled back immediately — nothing is kept.
--    Uncomment to run; it should print PASS and leave no row behind.
--
--    DO $$
--    DECLARE v_pid uuid;
--    BEGIN
--      SELECT id INTO v_pid FROM public.profiles LIMIT 1;
--      IF v_pid IS NULL THEN RAISE NOTICE 'SKIP — no profiles to test with'; RETURN; END IF;
--      BEGIN
--        INSERT INTO public.health_records (user_id, title) VALUES (v_pid, '__guard_probe__');
--        RAISE NOTICE 'PASS — non-anonymous insert allowed';
--        RAISE EXCEPTION 'rollback probe';   -- undo it
--      EXCEPTION
--        WHEN OTHERS THEN
--          IF SQLERRM LIKE '%GUEST_ACCOUNT_REQUIRED%' THEN
--            RAISE WARNING 'FAIL — guard blocked a NON-anonymous insert';
--          END IF;
--      END;
--    END $$;

-- 6. Guest accounts that already exist (after the dashboard toggle is on).
--    Informational: confirms handle_new_user gave each one a normal profile.
SELECT
  'INFO — ' || count(*) || ' anonymous account(s), ' ||
  count(*) FILTER (WHERE p.id IS NOT NULL) || ' with a profile row'
    AS check_6_guests
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE u.is_anonymous IS TRUE;
