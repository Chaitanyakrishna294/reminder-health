-- Deployment 1, phase 3: remove direct authenticated client writes after dashboard switches to RPC.

BEGIN;

DROP POLICY IF EXISTS "Allow insert for authenticated users" ON public.reminder_events;
DROP POLICY IF EXISTS "Allow select for authenticated users" ON public.reminder_events;
DROP POLICY IF EXISTS "Allow update for authenticated users" ON public.reminder_events;
DROP POLICY IF EXISTS "Patients view own events" ON public.reminder_events;
DROP POLICY IF EXISTS "Users view own events" ON public.reminder_events;
DROP POLICY IF EXISTS "Caregivers view patient events" ON public.reminder_events;
DROP POLICY IF EXISTS "Patients resolve own events" ON public.reminder_events;
DROP POLICY IF EXISTS "Users resolve own events" ON public.reminder_events;
DROP POLICY IF EXISTS "Caregivers resolve patient events" ON public.reminder_events;
DROP POLICY IF EXISTS "Users insert own reminder events" ON public.reminder_events;
DROP POLICY IF EXISTS "Caregivers insert patient reminder events" ON public.reminder_events;
DROP POLICY IF EXISTS "Users update own reminder events" ON public.reminder_events;
DROP POLICY IF EXISTS "Caregivers update accepted patient reminder events" ON public.reminder_events;

DROP POLICY IF EXISTS "Patients insert own logs" ON public.reminder_logs;
DROP POLICY IF EXISTS "Users insert own logs" ON public.reminder_logs;
DROP POLICY IF EXISTS "Caregivers insert patient logs" ON public.reminder_logs;

CREATE POLICY "Users view own events" ON public.reminder_events
  FOR SELECT TO authenticated
  USING (
    telegram_id IN (
      SELECT p.telegram_chat_id
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.telegram_chat_id IS NOT NULL
    )
  );

CREATE POLICY "Caregivers view patient events" ON public.reminder_events
  FOR SELECT TO authenticated
  USING (
    telegram_id IN (
      SELECT ci.patient_telegram_id
      FROM public.caregiver_info ci
      JOIN public.profiles p ON p.telegram_chat_id = ci.caregiver_chat_id
      WHERE p.id = auth.uid()
        AND p.role = 'CAREGIVER'
        AND ci.is_active = true
        AND ci.connection_status = 'ACCEPTED'
    )
  );

COMMIT;
