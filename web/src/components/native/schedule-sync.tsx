'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useUiMode } from '@/context/ui-mode-context';
import {
  getNativeActiveLadders,
  isNativeApp,
  notifyNativeDoseResolved,
  setNativeSession,
  syncScheduleToNative,
  syncWaterToNative,
  getNativeWaterCount,
  type MedicationPayload,
  type ResolvedDose,
} from '@/lib/native/schedule-bridge';
import type { SupabaseClient } from '@supabase/supabase-js';
import { localDayKey, minutesOfDay, waterSchedule } from '@/lib/water/hydration';

/**
 * RECONCILE RETRY LADDERS AGAINST THE SERVER.
 *
 * The device cancels a retry ladder when it sees the dose answered, and it sees
 * answers made on this device — the alarm screen, the notification, and (since
 * 2026-08-14) this webview, which reports them through `doseResolved`. What it
 * cannot see is an answer made somewhere else entirely: a CAREGIVER resolving
 * the dose from their own phone, or the patient answering on the web while this
 * phone was asleep. Nothing on this device was involved, so nothing told it.
 *
 * This is the catch-all. It asks native which ladders are still running, asks
 * the server whether those doses are in fact resolved, and reports back the ones
 * that are.
 *
 * **Ladder-first, deliberately.** A ladder only exists for a dose that went
 * unanswered past its time, which is rare, so the usual app-open makes one cheap
 * bridge call, gets an empty list, and stops — no query at all. Querying the
 * server first would have cost a round trip on every navigation to find nothing.
 *
 * The bound worth being honest about: this runs when the webview runs. A ladder
 * is at most 30 minutes long (the escalation clamp), so a caregiver's remote
 * answer can still leave the phone re-asking until the app is next opened. The
 * alternative is the device polling the server, which CLAUDE.md forbids and
 * which would break the offline guarantee the alarm core is built on.
 */
async function reconcileLadders(supabase: SupabaseClient): Promise<number> {
  const ladders = await getNativeActiveLadders();
  if (ladders.length === 0) return 0;

  const instants = ladders.map((l) => Date.parse(l.scheduledFor)).filter((n) => !Number.isNaN(n));
  if (instants.length === 0) return 0;

  const { data, error } = await supabase
    .from('reminder_events')
    .select('medication_id, scheduled_for, reminder_status')
    .in('medication_id', ladders.map((l) => l.medicationId))
    .gte('scheduled_for', new Date(Math.min(...instants)).toISOString())
    .lte('scheduled_for', new Date(Math.max(...instants)).toISOString());

  if (error || !data) {
    if (error) console.error('[ScheduleSync] ladder reconciliation query failed:', error);
    return 0;
  }

  const resolved: ResolvedDose[] = [];
  for (const ladder of ladders) {
    const at = Date.parse(ladder.scheduledFor);
    // Matched on the INSTANT, not on the string. Native sends its own ISO-8601
    // ("...T06:30:00Z") and PostgREST renders timestamptz differently
    // ("...T06:30:00+00:00"); the same moment, two spellings.
    const event = data.find(
      (e) => e.medication_id === ladder.medicationId && Date.parse(e.scheduled_for) === at,
    );
    if (event?.reminder_status === 'TAKEN' || event?.reminder_status === 'SKIPPED') {
      resolved.push({
        medicationId: ladder.medicationId,
        // The string NATIVE gave us — that is the key its own store and its
        // pending_retries row are written under.
        scheduledFor: ladder.scheduledFor,
        action: event.reminder_status === 'TAKEN' ? 'TAKEN' : 'SKIP',
      });
    }
  }

  if (resolved.length > 0) {
    await notifyNativeDoseResolved(resolved);
    console.log(
      `[ScheduleSync] cancelled ${resolved.length} retry ladder(s) for dose(s) already answered elsewhere`,
    );
  }
  return resolved.length;
}

/**
 * ORDERING CONSTRAINT — APPLY THE MIGRATION BEFORE DEPLOYING THIS.
 *
 * `retry_ladder_interval_minutes` and `retry_ladder_count` arrive with
 * migration_retry_ladder_2026_08_14.sql. PostgREST does not ignore a column it
 * does not know: it fails the ENTIRE select with "column ... does not exist".
 * So shipping this web build first does not degrade the retry ladder — it stops
 * `syncSchedule` outright, and every device silently keeps whatever schedule it
 * last stored while medication edits stop reaching the alarm core.
 *
 * That is the opposite of the failure this feature exists to prevent, and it is
 * invisible from the web: the dashboard is fine, only the phone goes stale.
 * Migration first, then deploy.
 */
const MEDICATION_COLUMNS =
  'id, drug_name, dosage, dosage_amount, unit_type, reminder_times, dose_days, timezone, next_reminder_at, active, medication_reason, priority_level, retry_ladder_interval_minutes, retry_ladder_count';

/**
 * Renders nothing. Pushes the current medication list into the native schedule
 * store (android-app/BRIDGE_CONTRACT.md's `syncSchedule`) — a no-op outside the
 * Capacitor app. RLS already scopes the query to the signed-in user's own
 * medications (the same policy every other medication read on this site relies
 * on), so no extra filtering is needed here. Guests included: the guest
 * write-guards cover only care circle and health vault, so a guest's own
 * medications sync and alarm exactly like a registered user's.
 *
 * Re-syncs on **pathname change** and on **app foreground**, not just on mount.
 * Mount alone was a real bug: this component lives in the (dashboard) layout,
 * which stays mounted across client-side navigations, so adding a medication
 * and navigating back never re-ran the sync — the new dose reached the alarm
 * store only after a full app restart. Pathname covers create/edit/delete
 * (all of which navigate); visibility covers a change made on another device
 * while the app sat in the background.
 *
 * Cheap enough to do on navigation: one indexed select of a handful of rows,
 * and the native side replaces its store wholesale anyway.
 */
export default function ScheduleSync() {
  const pathname = usePathname();
  const router = useRouter();
  // Mirrored to native so the KOTLIN alarm screen asks one dose at a time in
  // elderly mode. It cannot read this context — it is a different process with
  // no webview running — so the value has to travel over the bridge.
  const { isElderly } = useUiMode();

  useEffect(() => {
    if (!isNativeApp()) return;
    let cancelled = false;

    const sync = async () => {
      const supabase = createClient();

      // Session FIRST. It is what lets native call resolve_reminder_event /
      // snooze_reminder_event for any Taken/Skip/Snooze queued while offline, so
      // handing it over is also what drains that queue. Doing it before the
      // medication fetch means a returning user's pending actions sync on the
      // very first render rather than waiting for the next one.
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      if (session?.access_token && url && anonKey) {
        try {
          const result = await setNativeSession({
            accessToken: session.access_token,
            refreshToken: session.refresh_token ?? '',
            // Supabase reports expires_at in epoch SECONDS.
            expiresAt: session.expires_at ?? 0,
            supabaseUrl: url,
            supabaseAnonKey: anonKey,
            userId: session.user.id,
          });
          if (result && result.syncedPendingActions > 0) {
            console.log(`[ScheduleSync] synced ${result.syncedPendingActions} queued dose action(s)`);
            /**
             * THE SERVER JUST CHANGED UNDER US, so re-read it.
             *
             * Handing over the session is what drains the native queue, and the
             * queue is full of doses answered from the notification shade while
             * this webview was closed or backgrounded. Without this refresh the
             * page keeps showing them as due: the patient answered on the
             * notification, opens the app, and is asked the same question again —
             * and answering it a second time used to produce a red error toast
             * (fixed in todays-schedule.tsx) for a dose that was already safely
             * recorded.
             *
             * Only when something actually synced. An unconditional refresh here
             * would re-render the dashboard on every foreground and every
             * navigation, which is the calm rule's opposite.
             */
            router.refresh();
          }
        } catch (err) {
          console.error('[ScheduleSync] setSession failed:', err);
        }
      }

      if (cancelled) return;

      // Before anything else: a ladder still ringing for a dose somebody has
      // already answered is the loudest wrong thing this device can do.
      try {
        const cancelledLadders = await reconcileLadders(supabase);
        if (cancelledLadders > 0 && !cancelled) router.refresh();
      } catch (err) {
        console.error('[ScheduleSync] ladder reconciliation failed:', err);
      }

      if (cancelled) return;

      /*
       * How long each dose rings, mirrored to the device.
       *
       * ITS OWN QUERY, IN ITS OWN TRY. `profiles.alarm_ring_seconds` arrives with
       * migration_alarm_ring_seconds_2026_08_14.sql, and PostgREST fails the
       * ENTIRE select on a column it does not know — folding this into the
       * medication query would mean deploying before the migration stops
       * `syncSchedule` outright and every device silently goes stale. That is the
       * exact failure the retry-ladder ordering note warns about; here it is
       * avoidable, so it is avoided.
       */
      let ringSeconds: number | undefined;
      if (session?.user.id) {
        try {
          const { data: profile } = await supabase
            .from('profiles')
            .select('alarm_ring_seconds')
            .eq('id', session.user.id)
            .maybeSingle();
          if (profile?.alarm_ring_seconds) ringSeconds = profile.alarm_ring_seconds;
        } catch {
          // Not applied yet. The device keeps its 60s default, which is the
          // behaviour it already had.
        }
      }

      if (cancelled) return;

      const { data, error } = await supabase.from('medications').select(MEDICATION_COLUMNS);

      if (cancelled) return;
      if (error) {
        console.error('[ScheduleSync] Failed to load medications:', error);
        return;
      }
      if (!data) return;

      const medications: MedicationPayload[] = data.map((row) => ({
        id: row.id,
        drugName: row.drug_name,
        dosage: row.dosage,
        dosageAmount: row.dosage_amount,
        unitType: row.unit_type,
        reminderTimes: row.reminder_times ?? [],
        // The retry ladder's inputs. `?? null` because the DEFAULT state is
        // NULL — it means "use the priority default" — not because it guards
        // against the columns being absent. See the ORDERING note on
        // MEDICATION_COLUMNS: they are not optional at the query level.
        priorityLevel: row.priority_level ?? null,
        retryIntervalMinutes: row.retry_ladder_interval_minutes ?? null,
        retryCount: row.retry_ladder_count ?? null,
        doseDays: row.dose_days,
        timezone: row.timezone,
        nextReminderAt: row.next_reminder_at,
        active: row.active,
        medicationReason: row.medication_reason,
      }));

      /*
       * WATER — its own try, and last, because it is the quiet tier: a hydration
       * problem must never stop the medication schedule reaching the alarm core.
       *
       * The WEB computes the nudge times, including dropping the ones that clash
       * with a dose, so the settings preview and the phone cannot disagree about
       * when reminders arrive. Native only picks the next one.
       */
      if (session?.user.id) {
        try {
          const { data: w } = await supabase
            .from('water_settings')
            .select('enabled, goal_cups, window_start, window_end')
            .eq('user_id', session.user.id)
            .maybeSingle();

          if (w?.enabled) {
            const doseTimes = (data ?? []).flatMap((m) => m.reminder_times ?? []);
            const times = waterSchedule({
              startHhmm: String(w.window_start ?? '08:00').slice(0, 5),
              endHhmm: String(w.window_end ?? '21:00').slice(0, 5),
              goalCups: w.goal_cups ?? 8,
              doseTimes,
            });
            // The device counts cups too (the notification's Taken), so take the
            // larger of the two only HERE, on the way in: this is a merge of two
            // independent tallies, not a conflict between two edits of one.
            // Undo still wins everywhere it matters, because it writes the row.
            const deviceCups = (await getNativeWaterCount()) ?? 0;
            const { data: log } = await supabase
              .from('water_logs')
              .select('cups')
              .eq('user_id', session.user.id)
              .eq('day', localDayKey())
              .maybeSingle();
            const cupsToday = Math.max(deviceCups, log?.cups ?? 0);

            await syncWaterToNative({
              enabled: true,
              goalCups: w.goal_cups ?? 8,
              cupsToday,
              nudgeMinutes: times.map((t) => minutesOfDay(t) ?? 0).filter((n) => n > 0),
            });
          } else {
            await syncWaterToNative({ enabled: false, goalCups: 0, cupsToday: 0, nudgeMinutes: [] });
          }
        } catch {
          // Not applied yet, or offline. Water simply does not nudge.
        }
      }

      try {
        const result = await syncScheduleToNative(medications, session?.user.id, isElderly, ringSeconds);
        if (cancelled) return;
        console.log(
          `[ScheduleSync] synced ${medications.length} medication(s) to the native store` +
            ` (exact alarms allowed: ${result?.canScheduleExactAlarms}, elderly: ${isElderly},` +
            ` ring: ${ringSeconds ?? 'default'}s)`,
        );
      } catch (err) {
        console.error('[ScheduleSync] syncSchedule failed:', err);
      }
    };

    sync();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') sync();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    // `router` is intentionally not a dependency. Next's app-router instance is
    // stable, and listing it invites a future lint autofix to add something that
    // is not — which would re-subscribe the visibility listener and re-run the
    // whole sync on every render.
    //
    // `isElderly` IS one: switching to elderly mode has to reach the native
    // alarm screen straight away, not at the next navigation. Someone who turns
    // it on is telling us the current presentation is too much for them, and the
    // alarm is the screen where that matters most.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, isElderly]);

  return null;
}
