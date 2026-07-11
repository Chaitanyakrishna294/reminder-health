import { createServiceClient } from '@/lib/supabase/service-role';
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import crypto from 'crypto';
import { isBotAlive, isRecentlySent } from '@/lib/schedule/bot-liveness';
import { sendBrowserPush } from '@/lib/push/send-push';
import { calculateNextReminder } from '@/lib/medication-utils';

// Reminder send-FAILOVER. The Render bot (src/scheduler.js) is primary and writes a
// heartbeat each tick. This route is pinged every minute by an external cron with a
// CRON_SECRET Bearer. If the heartbeat is fresh the bot is alive and this route is a
// total no-op. If it is stale/missing the bot is down: this route takes over and
// sends browser push (initial dose, gentle reminder, caregiver escalation, snooze
// re-fire) using the SAME exactly-once guards the bot uses. Telegram is never sent
// here (it is dead when the bot is down). See docs/superpowers/specs/2026-07-11-*.
export const dynamic = 'force-dynamic';

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get('authorization') || '';
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Cron tick disabled.' }, { status: 503 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const ranAt = new Date().toISOString();

  // 1. Bot alive? -> total no-op (do NOT touch send-coupled RPCs).
  const { data: hb } = await supabase
    .from('scheduler_heartbeat')
    .select('last_beat')
    .eq('id', 1)
    .maybeSingle();
  if (isBotAlive(hb?.last_beat)) {
    return NextResponse.json({ ok: true, skipped: 'bot_alive', ranAt });
  }

  // 2. Takeover — mutually exclusive with any other tick via the shared lease.
  const holder = `vercel-cron-${crypto.randomUUID()}`;
  const { data: lockAcquired, error: lockErr } = await supabase.rpc('try_acquire_scheduler_lock', {
    p_lock_name: 'minute_tick',
    p_ttl_seconds: 120,
    p_holder: holder,
  });
  if (lockErr) {
    console.error('[CronTick] lock acquire failed:', lockErr);
    return NextResponse.json({ error: lockErr.message, ranAt }, { status: 500 });
  }
  if (!lockAcquired) {
    return NextResponse.json({ ok: true, skipped: 'locked', ranAt });
  }

  const now = new Date();
  let initialSends = 0;
  let transitionSends = 0;
  let snoozeSends = 0;

  try {
    // 2a. INITIAL DUE DOSE — mirror src/scheduler.js step 1, push-only.
    const sixtySecondsAgo = new Date(Date.now() - 60_000).toISOString();
    const { data: dueMeds } = await supabase
      .from('medications')
      .select('*')
      .eq('active', true)
      .lte('next_reminder_at', now.toISOString())
      .or(`last_sent_at.is.null,last_sent_at.lte.${sixtySecondsAgo}`);

    for (const med of dueMeds || []) {
      if (isRecentlySent(med.last_sent_at, now.getTime())) continue;

      // OCC-lock last_sent_at so only one process sends this dose.
      let lockQuery = supabase.from('medications').update({ last_sent_at: now.toISOString() }).eq('id', med.id);
      lockQuery = med.last_sent_at
        ? lockQuery.eq('last_sent_at', med.last_sent_at)
        : lockQuery.is('last_sent_at', null);
      const { data: locked } = await lockQuery.select();
      if (!locked || locked.length === 0) continue; // another process took it

      // Insert the SENT event; the (medication_id, scheduled_for) unique constraint dedupes.
      const scheduledFor = med.next_reminder_at;
      const { data: eventData, error: eventErr } = await supabase
        .from('reminder_events')
        .insert([{
          medication_id: med.id,
          telegram_id: med.telegram_id,
          scheduled_for: scheduledFor,
          reminder_status: 'SENT',
          retry_count: 0,
          snooze_count: 0,
          retry_reminder_at: null,
        }])
        .select();

      // On duplicate (23505) or success, advance next_reminder_at so it doesn't re-fire.
      const nextReminder = calculateNextReminder(med.reminder_times, med.timezone);
      await supabase
        .from('medications')
        .update({
          next_reminder_at: nextReminder.toISOString(),
          last_reminder_scheduled_at: med.next_reminder_at,
          retry_reminder_at: null,
          retry_count: 0,
        })
        .eq('id', med.id);

      if (eventErr || !eventData || eventData.length === 0) continue; // duplicate — already handled elsewhere

      await sendBrowserPush(med.telegram_id, {
        title: '💊 Medication Reminder',
        body: `Time to take ${med.drug_name}${med.dosage ? ` (${med.dosage})` : ''}.`,
        eventId: eventData[0].id,
      });
      initialSends++;
    }

    // 2b. GENTLE + ESCALATION — the RPC transitions state and returns what to send.
    const { data: transitions, error: scanErr } = await supabase.rpc('scan_and_escalate_overdue_reminders');
    if (scanErr) {
      console.error('[CronTick] scan_and_escalate failed:', scanErr);
    } else {
      for (const t of transitions || []) {
        if (t.new_status === 'GENTLE_REMINDER') {
          await sendBrowserPush(t.telegram_id, {
            title: '⏰ Gentle Reminder',
            body: `Please remember to take your ${t.drug_name}${t.dosage ? ` (${t.dosage})` : ''}.`,
            eventId: t.event_id,
          });
          transitionSends++;
        } else if (t.new_status === 'ESCALATED') {
          // Patient display name from profiles (no Telegram getChat available here).
          const { data: patient } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('telegram_chat_id', t.telegram_id)
            .maybeSingle();
          const patientName = patient?.full_name || 'Your patient';

          const { data: caregivers } = await supabase
            .from('active_caregiver_links')
            .select('caregiver_chat_id')
            .eq('patient_telegram_id', t.telegram_id)
            .eq('connection_status', 'ACCEPTED')
            .eq('is_active', true)
            .eq('can_receive_escalations', true);

          for (const cg of caregivers || []) {
            await sendBrowserPush(cg.caregiver_chat_id, {
              title: `⚠️ ${patientName} Missed Medication`,
              body: `${patientName} has not taken ${t.drug_name}. Action required.`,
              eventId: t.event_id,
            });
            transitionSends++;
          }
          await supabase.from('reminder_events').update({ caregiver_notified: true }).eq('id', t.event_id);
        }
      }
    }

    // 2c. SNOOZE RE-FIRE — expired snoozes back to SENT, push-only.
    const { data: expired } = await supabase
      .from('reminder_events')
      .select('*, medications:medication_id (*)')
      .eq('reminder_status', 'SNOOZED')
      .lte('retry_reminder_at', now.toISOString());

    for (const ev of expired || []) {
      const med = ev.medications;
      if (!med || !med.active) continue;
      const { data: updated } = await supabase
        .from('reminder_events')
        .update({ reminder_status: 'SENT', retry_reminder_at: null })
        .eq('id', ev.id)
        .eq('reminder_status', 'SNOOZED')
        .select();
      if (!updated || updated.length === 0) continue;
      await sendBrowserPush(med.telegram_id, {
        title: '⏰ Snooze Reminder',
        body: `Time to take ${med.drug_name}${med.dosage ? ` (${med.dosage})` : ''}.`,
        eventId: ev.id,
      });
      snoozeSends++;
    }

    // 2d. Day-end closure (idempotent).
    const { error: closeErr } = await supabase.rpc('close_daily_medications');
    if (closeErr) console.error('[CronTick] close_daily_medications failed:', closeErr);

    console.log(`[CronTick] FAILOVER ranAt=${ranAt} initial=${initialSends} transitions=${transitionSends} snoozes=${snoozeSends}`);
    return NextResponse.json({ ok: true, mode: 'failover', ranAt, initialSends, transitionSends, snoozeSends });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    console.error('[CronTick] failover error:', error);
    return NextResponse.json({ error: message, ranAt }, { status: 500 });
  } finally {
    const { error: relErr } = await supabase.rpc('release_scheduler_lock', {
      p_lock_name: 'minute_tick',
      p_holder: holder,
    });
    if (relErr) console.error('[CronTick] lock release failed:', relErr);
  }
}
