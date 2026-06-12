-- Re-MIND-eЯ Sprint 5.6C.1: Patch — Request Expiration, Primary Assignment, Notification Cleanup
-- Migration Script: migration_5.6c.1_expiration_and_primary.sql
-- Run this in your Supabase SQL Editor AFTER migration_carecircle_access_requests_phase_c.sql.
--
-- Fixes:
--   1. Automated PENDING → EXPIRED transition via pg_cron
--   2. Primary caregiver auto-assignment on first accept (database-level trigger)
--   3. Notification auto-cleanup on connection resolution

BEGIN;

-- ============================================================================
-- 1. REQUEST EXPIRATION: pg_cron Scheduled Job
-- ============================================================================

-- 1a. Create the expiration function
CREATE OR REPLACE FUNCTION public.expire_stale_connection_requests()
RETURNS void AS $$
DECLARE
  expired_count INTEGER;
BEGIN
  -- Transition PENDING → EXPIRED for requests past their expires_at
  UPDATE public.caregiver_connections
  SET connection_status = 'EXPIRED',
      is_active = false,
      updated_at = now()
  WHERE connection_status = 'PENDING'
    AND expires_at IS NOT NULL
    AND expires_at < now();

  GET DIAGNOSTICS expired_count = ROW_COUNT;

  -- Delete associated ephemeral notifications for expired requests
  DELETE FROM public.notifications
  WHERE type = 'CARE_CIRCLE_ACCESS_REQUEST'
    AND connection_id IN (
      SELECT id FROM public.caregiver_connections
      WHERE connection_status = 'EXPIRED'
    );

  -- Log expiration activity if any rows were affected
  IF expired_count > 0 THEN
    RAISE NOTICE '[5.6C.1] Expired % stale connection requests', expired_count;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 1b. Schedule the daily cron job (1:00 AM UTC)
-- pg_cron is already enabled from migration_health_vault_stabilization.sql

-- Remove duplicate schedule if it exists
SELECT cron.unschedule('expire-stale-requests-job')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'expire-stale-requests-job'
);

SELECT cron.schedule(
  'expire-stale-requests-job',
  '0 1 * * *',  -- Daily at 1:00 AM UTC
  'SELECT public.expire_stale_connection_requests()'
);


-- ============================================================================
-- 2. PRIMARY CAREGIVER AUTO-ASSIGNMENT (Database-Level Trigger)
-- ============================================================================
-- When a connection transitions to ACCEPTED, check if the patient already
-- has a primary caregiver. If not, auto-assign this connection as primary.
-- This ensures the first accepted caregiver is always the Primary Coordinator.
-- The patient remains the source of authority — they can reassign later.

CREATE OR REPLACE FUNCTION public.auto_assign_primary_caregiver()
RETURNS TRIGGER AS $$
DECLARE
  existing_primary_count INTEGER;
BEGIN
  -- Only act on transitions TO 'ACCEPTED'
  IF NEW.connection_status = 'ACCEPTED' AND 
     (OLD.connection_status IS NULL OR OLD.connection_status IS DISTINCT FROM 'ACCEPTED') THEN
    
    -- Count existing primary caregivers for this patient
    SELECT COUNT(*) INTO existing_primary_count
    FROM public.caregiver_connections
    WHERE patient_profile_id = NEW.patient_profile_id
      AND is_primary = true
      AND is_active = true
      AND connection_status = 'ACCEPTED'
      AND id != NEW.id;

    -- If no primary exists, this becomes the primary
    IF existing_primary_count = 0 THEN
      NEW.is_primary := true;
    ELSE
      NEW.is_primary := false;
    END IF;
  END IF;

  -- If a primary caregiver disconnects (REJECTED/EXPIRED/WITHDRAWN),
  -- auto-promote the next oldest accepted caregiver
  IF OLD.is_primary = true AND 
     NEW.connection_status IN ('REJECTED', 'EXPIRED', 'WITHDRAWN') AND
     OLD.connection_status = 'ACCEPTED' THEN
    
    -- Promote the next oldest accepted caregiver
    UPDATE public.caregiver_connections
    SET is_primary = true, updated_at = now()
    WHERE id = (
      SELECT id FROM public.caregiver_connections
      WHERE patient_profile_id = NEW.patient_profile_id
        AND is_active = true
        AND connection_status = 'ACCEPTED'
        AND id != NEW.id
      ORDER BY created_at ASC
      LIMIT 1
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach as BEFORE UPDATE trigger so we can modify NEW row in-place
DROP TRIGGER IF EXISTS trg_auto_assign_primary_caregiver ON public.caregiver_connections;

CREATE TRIGGER trg_auto_assign_primary_caregiver
BEFORE UPDATE ON public.caregiver_connections
FOR EACH ROW
EXECUTE FUNCTION public.auto_assign_primary_caregiver();


-- ============================================================================
-- 3. NOTIFICATION AUTO-CLEANUP TRIGGER
-- ============================================================================
-- When a connection transitions OUT of PENDING (to any terminal state),
-- delete the associated ephemeral CARE_CIRCLE_ACCESS_REQUEST notification.
-- This prevents notification bell clutter from resolved requests.

CREATE OR REPLACE FUNCTION public.cleanup_resolved_request_notifications()
RETURNS TRIGGER AS $$
BEGIN
  -- When connection moves from PENDING to any resolution state
  IF OLD.connection_status = 'PENDING' AND 
     NEW.connection_status IN ('ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED') THEN
    
    DELETE FROM public.notifications
    WHERE connection_id = NEW.id
      AND type = 'CARE_CIRCLE_ACCESS_REQUEST';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cleanup_resolved_notifications ON public.caregiver_connections;

CREATE TRIGGER trg_cleanup_resolved_notifications
AFTER UPDATE ON public.caregiver_connections
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_resolved_request_notifications();


-- ============================================================================
-- 4. BACKFILL: Fix any existing accepted connections with no primary
-- ============================================================================
-- For each patient that has accepted connections but no primary,
-- promote the oldest accepted connection to primary.

WITH patients_without_primary AS (
  SELECT DISTINCT patient_profile_id
  FROM public.caregiver_connections
  WHERE connection_status = 'ACCEPTED'
    AND is_active = true
  EXCEPT
  SELECT patient_profile_id
  FROM public.caregiver_connections
  WHERE connection_status = 'ACCEPTED'
    AND is_active = true
    AND is_primary = true
),
oldest_connection AS (
  SELECT DISTINCT ON (cc.patient_profile_id) cc.id
  FROM public.caregiver_connections cc
  JOIN patients_without_primary pwp ON pwp.patient_profile_id = cc.patient_profile_id
  WHERE cc.connection_status = 'ACCEPTED'
    AND cc.is_active = true
  ORDER BY cc.patient_profile_id, cc.created_at ASC
)
UPDATE public.caregiver_connections
SET is_primary = true, updated_at = now()
WHERE id IN (SELECT id FROM oldest_connection);


COMMIT;
