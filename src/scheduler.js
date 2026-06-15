const crypto = require('crypto');
const cron = require('node-cron');
const moment = require('moment-timezone');
const webpush = require('web-push');
const { bot } = require('./bot');
const { supabase } = require('./db');
const { delay, calculateNextReminder, escapeHTML, activeSnoozes } = require('./utils');
const { CALLBACK_ACTIONS, MAX_SNOOZES } = require('./constants');

// Unique id for this process, used to claim the cross-instance minute-tick lease
// so two overlapping instances (deploy/restart) can't double-escalate reminders.
const SCHEDULER_INSTANCE_ID = crypto.randomUUID();

// ── Browser Push Setup ──────────────────────────────────────────────────────
if (!process.env.VAPID_SUBJECT || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
  console.warn('[Push] VAPID env vars missing — browser push notifications disabled.');
} else {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  console.log('[Push] web-push VAPID initialized.');
}

/**
 * sendBrowserPush — fire-and-forget browser push to all subscriptions for a telegram user.
 * @param {string} telegramId  - The patient or caregiver telegram_chat_id
 * @param {{ title: string, body: string, eventId?: string|number }} payload
 */
async function sendBrowserPush(telegramId, payload) {
  if (!process.env.VAPID_PRIVATE_KEY) return; // VAPID not configured
  try {
    // 1. Find user profile by telegram_chat_id
    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('id')
      .eq('telegram_chat_id', telegramId)
      .single();

    if (profErr || !profile) return; // user not registered on web dashboard

    // 2. Fetch all push subscriptions for this user
    const { data: subs, error: subErr } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', profile.id);

    if (subErr || !subs || subs.length === 0) return; // no subscriptions

    // Generate cryptographically secure tracking token for reminder events
    let trackingToken = null;
    if (payload.eventId) {
      const crypto = require('crypto');
      trackingToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(trackingToken).digest('hex');
      
      // Store token hash in push_tracking_tokens
      await supabase.from('push_tracking_tokens').insert([{
        event_id: payload.eventId,
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      }]);
    }

    const pushPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      eventId: payload.eventId || null,
      trackingToken: trackingToken
    });

    // 3. Send to each subscription, delete expired ones
    for (const sub of subs) {
      const subscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth }
      };
      let gateway = 'Unknown Gateway';
      try {
        gateway = new URL(sub.endpoint).hostname;
      } catch (urlErr) {}

      try {
        console.log(`[PUSH_DIAGNOSTIC] Action: push_dispatching | User: ${profile.id} | SubID: ${sub.id} | Endpoint: ...${sub.endpoint.slice(-20)}`);
        await webpush.sendNotification(subscription, pushPayload);
        console.log(`[PUSH_DIAGNOSTIC] Action: push_delivered | User: ${profile.id} | SubID: ${sub.id} | Gateway: ${gateway}`);
        
        await supabase.from('push_logs').upsert([{
          user_id: profile.id,
          event_id: payload.eventId || null,
          status: 'SENT',
          gateway: gateway
        }], { onConflict: 'event_id,status', ignoreDuplicates: true });
      } catch (pushErr) {
        let status = 'FAILED';
        let errorMessage = pushErr.message;
        
        if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
          status = 'EXPIRED';
          console.log(`[PUSH_DIAGNOSTIC] Action: subscription_removed | SubID: ${sub.id} | Status: ${pushErr.statusCode} (Expired/Gone)`);
          await supabase.from('push_subscriptions').delete().eq('id', sub.id);
        } else {
          console.error(`[PUSH_DIAGNOSTIC] Action: gateway_error | SubID: ${sub.id} | Code: ${pushErr.statusCode || 'Unknown'} | Error: ${pushErr.message}`);
        }
        
        await supabase.from('push_logs').upsert([{
          user_id: profile.id,
          event_id: payload.eventId || null,
          status: status,
          gateway: gateway,
          error_message: errorMessage
        }], { onConflict: 'event_id,status', ignoreDuplicates: true });
      }
    }
  } catch (err) {
    console.error('[Push] sendBrowserPush error:', err);
  }
}

// Startup self-check: the minute tick depends on the scheduler-lock RPCs from
// migration_arch_hardening_2026_06.sql. If that migration hasn't been applied, the
// RPC errors every tick and the scheduler silently does nothing. Verify once at
// boot and fail loudly so "deploy code" and "apply migration" stay coupled.
const verifySchedulerDependencies = async () => {
  const { error } = await supabase.rpc('try_acquire_scheduler_lock', {
    p_lock_name: 'startup_self_check',
    p_ttl_seconds: 1,
    p_holder: SCHEDULER_INSTANCE_ID
  });
  if (error) {
    console.error(
      '[Scheduler] FATAL: scheduler-lock RPC missing or failing — the minute tick will not run. ' +
      'Apply db/migrations/migration_arch_hardening_2026_06.sql before deploying this code.',
      error
    );
    return false;
  }
  // Release the probe lease immediately so it doesn't block the first real tick.
  await supabase.rpc('release_scheduler_lock', {
    p_lock_name: 'startup_self_check',
    p_holder: SCHEDULER_INSTANCE_ID
  });
  console.log('[Scheduler] Dependency self-check passed (scheduler-lock RPCs present).');
  return true;
};

const initScheduler = () => {
  console.log('⏰ Schedulers initialized.');

  // Run the dependency self-check up front (non-blocking; logs FATAL if unmet).
  verifySchedulerDependencies();

  // 1. Every Minute Reminder Checker
  cron.schedule('* * * * *', async () => {
    let lockHeld = false;
    try {
      const now = new Date();

      // Claim the cross-instance minute-tick lease. If another instance holds it
      // (overlap during deploy/restart), skip this tick rather than double-process.
      const { data: lockAcquired, error: lockAcquireErr } = await supabase.rpc('try_acquire_scheduler_lock', {
        p_lock_name: 'minute_tick',
        p_ttl_seconds: 120,
        p_holder: SCHEDULER_INSTANCE_ID
      });
      if (lockAcquireErr) {
        console.error('[Scheduler] Failed to acquire minute-tick lock; skipping tick:', lockAcquireErr);
        return;
      }
      if (!lockAcquired) {
        console.log('[Scheduler] Another instance holds the minute-tick lock; skipping this tick.');
        return;
      }
      lockHeld = true;

      console.log(`[Scheduler] Checking for due reminders at ${now.toISOString()}...`);

      const sixtySecondsAgo = new Date(Date.now() - 60000).toISOString();

      // Fetch active medications where next_reminder_at is in the past or now
      // AND last_sent_at is null or older than 60 seconds
      const { data: dueMedications, error } = await supabase
        .from('medications')
        .select('*')
        .eq('active', true)
        .lte('next_reminder_at', now.toISOString())
        .or(`last_sent_at.is.null,last_sent_at.lte.${sixtySecondsAgo}`);

      if (error) {
        console.error('[Scheduler] Error fetching due medications:', error);
        return;
      }

      console.log(`[Scheduler] Found ${dueMedications ? dueMedications.length : 0} due scheduled medications.`);

      if (dueMedications && dueMedications.length > 0) {
        for (const med of dueMedications) {
          console.log(`[Scheduler] Processing reminder configuration for Med ID: ${med.id}`);

          // Prevent duplicate reminders within 60 seconds in case JS loop is faster than DB query
          if (med.last_sent_at) {
            const lastSent = new Date(med.last_sent_at);
            const diffSeconds = (now - lastSent) / 1000;
            if (diffSeconds < 60) {
              console.log(`[Scheduler] Skipping duplicate for med ${med.id}`);
              continue;
            }
          }

          const scheduledTimeMs = new Date(med.next_reminder_at).getTime();

          // Reset snooze counter in activeSnoozes if this is a fresh regular reminder cycle
          const nextTimeIST = moment(med.next_reminder_at).tz('Asia/Kolkata').format('HH:mm');
          if (med.reminder_times.includes(nextTimeIST)) {
            delete activeSnoozes[med.id];
          }

          const currentSnoozes = activeSnoozes[med.id] || 0;
          const buttons = [
            { text: '✅ TAKEN', callback_data: `${CALLBACK_ACTIONS.TAKEN}:${med.id}:${scheduledTimeMs}` },
            { text: '⏭ SKIP', callback_data: `${CALLBACK_ACTIONS.SKIP}:${med.id}:${scheduledTimeMs}` }
          ];

          if (currentSnoozes < MAX_SNOOZES) {
            buttons.splice(1, 0, { text: '⏰ Snooze 10m', callback_data: `${CALLBACK_ACTIONS.SNOOZE}:${med.id}:${scheduledTimeMs}` });
          }

          const inlineKeyboard = {
            inline_keyboard: [ buttons ]
          };

          const message = `💊 Time to take <b>${escapeHTML(med.drug_name)}</b>${med.dosage ? ` (${escapeHTML(med.dosage)})` : ''}`;

          try {
            console.log(`[Scheduler] IMMEDIATELY locking medication record for Med ID: ${med.id}`);
            // 1. Update last_sent_at IMMEDIATELY before sending to lock it using Optimistic Concurrency Control
            let lockQuery = supabase
              .from('medications')
              .update({ last_sent_at: now.toISOString() })
              .eq('id', med.id);
              
            if (med.last_sent_at) {
              lockQuery = lockQuery.eq('last_sent_at', med.last_sent_at);
            } else {
              lockQuery = lockQuery.is('last_sent_at', null);
            }

            const { data: lockData, error: lockErr } = await lockQuery.select();

            if (lockErr || !lockData || lockData.length === 0) {
              console.log(`[Scheduler] Med ID ${med.id} was already locked by another process. Skipping duplicate send.`);
              continue;
            }

            // 2. Insert event in reminder_events table (Idempotency check via Unique Constraint)
            const scheduledFor = med.next_reminder_at;
            const intervalMinutes = med.priority_level === 'critical' ? 5 : 15;
            const retryReminderAt = new Date(Date.now() + intervalMinutes * 60 * 1000).toISOString();

            const payload = {
              medication_id: med.id,
              telegram_id: med.telegram_id,
              scheduled_for: scheduledFor,
              reminder_status: 'SENT',
              retry_count: 0,
              snooze_count: currentSnoozes,
              retry_reminder_at: null
            };
            console.log('[Scheduler] reminder_event payload:', payload);

            console.log(`[Scheduler] Creating reminder_event for Med ID: ${med.id}, Scheduled: ${scheduledFor}`);
            const { data: eventData, error: eventErr } = await supabase
              .from('reminder_events')
              .insert([payload])
              .select();

            if (eventErr || !eventData || eventData.length === 0) {
              console.error(`[Scheduler] Failed to create reminder_event (already exists / duplicate) for Med ID ${med.id}:`, eventErr);
              
              if (eventErr && eventErr.code === '23505') {
                console.log(`[Scheduler] Unique constraint violation: Event already exists for Med ID ${med.id} scheduled at ${scheduledFor}. Advancing next_reminder_at to avoid duplicate loop.`);
                try {
                  const nextReminder = calculateNextReminder(med.reminder_times, med.timezone);
                  console.log(`[Scheduler] Updating next_reminder_at for Med ID: ${med.id} to ${nextReminder.toISOString()} (recovering from duplicate)`);
                  await supabase
                    .from('medications')
                    .update({
                      next_reminder_at: nextReminder.toISOString(),
                      last_reminder_scheduled_at: med.next_reminder_at,
                      retry_reminder_at: null,
                      retry_count: 0
                    })
                    .eq('id', med.id);
                } catch (updateErr) {
                  console.error(`[Scheduler] Failed to update next_reminder_at during recovery for Med ID ${med.id}:`, updateErr);
                }
              }
              continue;
            }

            console.log(`[Workflow State Change] Created reminder_event ID ${eventData[0].id} for Med ID ${med.id} with status 'SENT'`);
            console.log(`[Scheduler] Sending Telegram message for Med ID: ${med.id}`);
            // 3. Send Reminder (Telegram + Browser Push)
            try {
              await bot.sendMessage(med.telegram_id, message, { parse_mode: 'HTML', reply_markup: inlineKeyboard });
            } catch (tgErr) {
              console.error(`[Scheduler] Telegram failed to send reminder to ${med.telegram_id}:`, tgErr.message || tgErr);
            }
            await sendBrowserPush(med.telegram_id, {
              title: '💊 Medication Reminder',
              body: `Time to take ${med.drug_name}${med.dosage ? ` (${med.dosage})` : ''}.`,
              eventId: eventData[0] ? eventData[0].id : null
            });

            // 4. Calculate next reminder from the JSONB array
            const nextReminder = calculateNextReminder(med.reminder_times, med.timezone);

            console.log(`[Scheduler] Updating next_reminder_at for Med ID: ${med.id} to ${nextReminder.toISOString()}`);
            // 5. Update record with next_reminder_at, reset old retry columns.
            // This must succeed — a silent failure leaves next_reminder_at stale and the
            // medication either re-fires every tick or skips its next dose. Verify it.
            const { data: advanceData, error: advanceErr } = await supabase
              .from('medications')
              .update({
                next_reminder_at: nextReminder.toISOString(),
                last_reminder_scheduled_at: med.next_reminder_at,
                retry_reminder_at: null,
                retry_count: 0
              })
              .eq('id', med.id)
              .select();

            if (advanceErr || !advanceData || advanceData.length === 0) {
              console.error(`[Scheduler] CRITICAL: Failed to advance next_reminder_at for Med ID ${med.id}; it may re-fire next tick:`, advanceErr || 'no row updated');
            }

            // 6. Add a small delay between sends to avoid Telegram API flood limits
            await delay(200);

          } catch (sendErr) {
            console.error(`[Scheduler] Failed to send reminder to ${med.telegram_id}:`, sendErr);
            
            // Retry once logic
            try {
              await delay(1000);
              await bot.sendMessage(med.telegram_id, message, { parse_mode: 'HTML', reply_markup: inlineKeyboard });
              const nextReminder = calculateNextReminder(med.reminder_times, med.timezone);
              await supabase
                .from('medications')
                .update({
                  next_reminder_at: nextReminder.toISOString(),
                  last_reminder_scheduled_at: med.next_reminder_at,
                  retry_reminder_at: null,
                  retry_count: 0
                })
                .eq('id', med.id);
            } catch (retryErr) {
              console.error(`[Scheduler] Retry failed for ${med.telegram_id}:`, retryErr);
            }
          }
        }
      }

      // 1.5. Checking for pending retries / snoozes in reminder_events via DB RPC
      console.log(`[Scheduler] Scanning and escalating overdue reminders via DB RPC at ${now.toISOString()}...`);
      const { data: transitions, error: scanErr } = await supabase.rpc('scan_and_escalate_overdue_reminders');

      if (scanErr) {
        console.error('[Scheduler] Error calling scan_and_escalate_overdue_reminders:', scanErr);
      } else if (transitions && transitions.length > 0) {
        console.log(`[Scheduler] scan_and_escalate_overdue_reminders returned ${transitions.length} transitions.`);
        for (const transition of transitions) {
          const scheduledTimeMs = new Date(transition.scheduled_for).getTime();
          
          if (transition.new_status === 'GENTLE_REMINDER') {
            console.log(`[Workflow State Change] Event ID ${transition.event_id} transitioned to GENTLE_REMINDER. Sending re-engagement reminder.`);
            
            // Fetch the event to get correct snooze count
            const { data: eventRow } = await supabase
              .from('reminder_events')
              .select('snooze_count')
              .eq('id', transition.event_id)
              .single();
            const currentSnoozes = eventRow ? eventRow.snooze_count : 0;

            const buttons = [
              { text: '✅ TAKEN', callback_data: `${CALLBACK_ACTIONS.TAKEN}:${transition.medication_id}:${scheduledTimeMs}` },
              { text: '⏭ SKIP', callback_data: `${CALLBACK_ACTIONS.SKIP}:${transition.medication_id}:${scheduledTimeMs}` }
            ];

            if (currentSnoozes < MAX_SNOOZES) {
              buttons.splice(1, 0, { text: '⏰ Snooze 10m', callback_data: `${CALLBACK_ACTIONS.SNOOZE}:${transition.medication_id}:${scheduledTimeMs}` });
            }

            const inlineKeyboard = {
              inline_keyboard: [ buttons ]
            };

            const message = `⏰ <b>Gentle Reminder:</b> Please take your <b>${escapeHTML(transition.drug_name)}</b>${transition.dosage ? ` (${escapeHTML(transition.dosage)})` : ''}.`;
            try {
              await bot.sendMessage(transition.telegram_id, message, { parse_mode: 'HTML', reply_markup: inlineKeyboard });
            } catch (tgErr) {
              console.error(`[Scheduler] Telegram failed to send gentle reminder to ${transition.telegram_id}:`, tgErr.message || tgErr);
            }
            await sendBrowserPush(transition.telegram_id, {
              title: '⏰ Gentle Reminder',
              body: `Please remember to take your ${transition.drug_name}${transition.dosage ? ` (${transition.dosage})` : ''}.`,
              eventId: transition.event_id
            });
            await delay(200);
          } else if (transition.new_status === 'ESCALATED') {
            console.log(`[Workflow State Change] Event ID ${transition.event_id} transitioned to ESCALATED. Notifying caregivers.`);
            
            // Fetch active caregivers for this patient
            const { data: caregivers, error: cgErr } = await supabase
              .from('active_caregiver_links')
              .select('caregiver_chat_id')
              .eq('patient_telegram_id', transition.telegram_id)
              .eq('connection_status', 'ACCEPTED')
              .eq('is_active', true)
              .eq('can_receive_escalations', true);

            if (cgErr) {
              console.error('[Scheduler] Error fetching caregivers for escalation:', cgErr);
              continue;
            }

            if (caregivers && caregivers.length > 0) {
              // Fetch patient name dynamically from Telegram
              let patientName = 'Patient';
              try {
                const chatInfo = await bot.getChat(transition.telegram_id);
                patientName = `${chatInfo.first_name || ''} ${chatInfo.last_name || ''}`.trim() || 'Patient';
              } catch (chatErr) {
                console.error('[Scheduler] Failed to get patient chat details:', chatErr);
              }

              const formattedTime = moment(transition.scheduled_for)
                .tz('Asia/Kolkata')
                .format('h:mm A');

              const priorityEmoji = transition.priority_level === 'critical' ? '🔴 CRITICAL' : transition.priority_level === 'important' ? '🟠 IMPORTANT' : '🟢 NORMAL';
              const alertMessage = `🚨 <b>Medication Alert (${priorityEmoji})</b>\n\nA medication for <b>${escapeHTML(patientName)}</b> (<b>${escapeHTML(transition.drug_name)}</b>${transition.dosage ? ` - ${escapeHTML(transition.dosage)}` : ''} due at <b>${formattedTime}</b>) has not yet been confirmed. Please verify or check with them.`;

              const alertButtons = {
                inline_keyboard: [
                  [
                    { text: '🤝 Acknowledge Alert', callback_data: `${CALLBACK_ACTIONS.CG_ACKNOWLEDGE}:${transition.medication_id}:${scheduledTimeMs}` },
                    { text: '✅ Confirm Taken', callback_data: `${CALLBACK_ACTIONS.CG_TAKEN}:${transition.medication_id}:${scheduledTimeMs}` }
                  ]
                ]
              };

              for (const cg of caregivers) {
                try {
                  await bot.sendMessage(cg.caregiver_chat_id, alertMessage, { parse_mode: 'HTML', reply_markup: alertButtons });
                  console.log(`[Scheduler] Sent missed dose alert to Caregiver: ${cg.caregiver_chat_id}`);
                } catch (tgErr) {
                  console.error(`[Scheduler] Telegram failed to send caregiver alert to ${cg.caregiver_chat_id}:`, tgErr.message || tgErr);
                }
                await sendBrowserPush(cg.caregiver_chat_id, {
                  title: `⚠️ ${patientName} Missed Medication`,
                  body: `${patientName} has not taken ${transition.drug_name}. Action required.`,
                  eventId: transition.event_id
                });
              }

              // Update event to indicate caregiver has been notified
              await supabase
                .from('reminder_events')
                .update({ caregiver_notified: true })
                .eq('id', transition.event_id);
            }
          } else if (transition.new_status === 'PENDING_REVIEW') {
            console.log(`[Workflow State Change] Event ID ${transition.event_id} transitioned to PENDING_REVIEW (silenced)`);
          }
        }
      }

      // Check for expired snoozes and transition them back to SENT
      console.log(`[Scheduler] Checking for expired snoozes...`);
      const { data: expiredSnoozes, error: snoozeError } = await supabase
        .from('reminder_events')
        .select(`
          *,
          medications:medication_id (
            *
          )
        `)
        .eq('reminder_status', 'SNOOZED')
        .lte('retry_reminder_at', now.toISOString());

      if (snoozeError) {
        console.error('[Scheduler] Error fetching expired snoozes:', snoozeError);
      } else if (expiredSnoozes && expiredSnoozes.length > 0) {
        for (const event of expiredSnoozes) {
          const med = event.medications;
          if (!med || !med.active) continue;

          try {
            const { data: updateData, error: updateErr } = await supabase
              .from('reminder_events')
              .update({
                reminder_status: 'SENT',
                retry_reminder_at: null
              })
              .eq('id', event.id)
              .eq('reminder_status', 'SNOOZED')
              .select();

            if (updateErr || !updateData || updateData.length === 0) continue;

            console.log(`[Workflow State Change] Snooze expired for Event ID ${event.id}. Transitioned status from SNOOZED to SENT`);
            const scheduledTimeMs = new Date(event.scheduled_for).getTime();
            const currentSnoozes = event.snooze_count;
            const buttons = [
              { text: '✅ TAKEN', callback_data: `${CALLBACK_ACTIONS.TAKEN}:${med.id}:${scheduledTimeMs}` },
              { text: '⏭ SKIP', callback_data: `${CALLBACK_ACTIONS.SKIP}:${med.id}:${scheduledTimeMs}` }
            ];

            if (currentSnoozes < MAX_SNOOZES) {
              buttons.splice(1, 0, { text: '⏰ Snooze 10m', callback_data: `${CALLBACK_ACTIONS.SNOOZE}:${med.id}:${scheduledTimeMs}` });
            }

            const inlineKeyboard = {
              inline_keyboard: [ buttons ]
            };

            const message = `💊 Time to take <b>${escapeHTML(med.drug_name)}</b>${med.dosage ? ` (${escapeHTML(med.dosage)})` : ''}`;
            try {
              await bot.sendMessage(med.telegram_id, message, { parse_mode: 'HTML', reply_markup: inlineKeyboard });
            } catch (tgErr) {
              console.error(`[Scheduler] Telegram failed to send snooze reminder to ${med.telegram_id}:`, tgErr.message || tgErr);
            }
            await sendBrowserPush(med.telegram_id, {
              title: '⏰ Snooze Reminder',
              body: `Time to take ${med.drug_name}${med.dosage ? ` (${med.dosage})` : ''}.`,
              eventId: event.id
            });
            await delay(200);
          } catch (snoozeErr) {
            console.error(`[Scheduler] Failed to process snooze expiration for Event ID ${event.id}:`, snoozeErr);
          }
        }
      }

      // Close daily medications if past closure window
      console.log(`[Scheduler] Closing daily medications if past closure window...`);
      const { error: closeErr } = await supabase.rpc('close_daily_medications');
      if (closeErr) {
        console.error('[Scheduler] Error running close_daily_medications:', closeErr);
      } else {
        console.log('[Scheduler] close_daily_medications run successfully.');
      }
    } catch (err) {
      console.error('Scheduler error:', err);
    } finally {
      // Release the lease on clean (or errored) completion so the next tick isn't
      // blocked by the TTL. A crash before this still self-heals when the lease expires.
      if (lockHeld) {
        const { error: lockReleaseErr } = await supabase.rpc('release_scheduler_lock', {
          p_lock_name: 'minute_tick',
          p_holder: SCHEDULER_INSTANCE_ID
        });
        if (lockReleaseErr) {
          console.error('[Scheduler] Failed to release minute-tick lock:', lockReleaseErr);
        }
      }
    }
  });

  // 2. Weekly Summary - Sundays at 8 PM (20:00) Asia/Kolkata
  cron.schedule('0 20 * * 0', async () => {
    try {
      console.log('📊 Generating weekly summaries...');
      
      // Get all active users
      const { data: users, error: userErr } = await supabase
        .from('medications')
        .select('telegram_id')
        .eq('active', true);

      if (userErr) throw userErr;

      // Unique telegram IDs
      const uniqueUsers = [...new Set(users.map(u => u.telegram_id))];

      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      for (const telegramId of uniqueUsers) {
        const { data: logs, error: logErr } = await supabase
          .from('reminder_logs')
          .select('response, medication_id')
          .eq('telegram_id', telegramId)
          .gte('scheduled_time', weekAgo.toISOString());

        if (logErr || !logs || logs.length === 0) continue;

        const medIds = [...new Set(logs.map(l => l.medication_id))];
        const { data: meds, error: medsError } = await supabase
          .from('medications')
          .select('id, drug_name')
          .in('id', medIds);

        if (medsError) {
          console.error(`Error fetching medications for weekly stats (${telegramId}):`, medsError);
          continue;
        }

        const medMap = {};
        if (meds) {
          meds.forEach(m => medMap[m.id] = m.drug_name);
        }

        const stats = {};
        logs.forEach(log => {
          const drug = medMap[log.medication_id] || 'Unknown';
          if (!stats[drug]) stats[drug] = { total: 0, taken: 0 };
          
          stats[drug].total += 1;
          if (log.response === 'TAKEN') {
            stats[drug].taken += 1;
          }
        });

        let summaryMessage = "📊 <b>Weekly Health Summary</b>\n\n";
        for (const [drug, data] of Object.entries(stats)) {
          const percentage = Math.round((data.taken / data.total) * 100);
          summaryMessage += `<b>${escapeHTML(drug)}</b> → ${data.taken}/${data.total} doses (${percentage}%)\n`;
        }
        summaryMessage += "\nKeep going 💪";

        try {
          await bot.sendMessage(telegramId, summaryMessage, { parse_mode: 'HTML' });
          await delay(200); // Flood control
        } catch (err) {
          console.error(`Error sending weekly summary to ${telegramId}:`, err);
        }
      }

    } catch (err) {
      console.error('Weekly summary error:', err);
    }
  }, {
    timezone: "Asia/Kolkata"
  });

  // 3. Daily Low Stock Alert - Every day at 9:00 AM Asia/Kolkata
  cron.schedule('0 9 * * *', async () => {
    try {
      console.log('📦 Checking for low stock medications...');
      
      const { data: activeMeds, error } = await supabase
        .from('medications')
        .select('*')
        .eq('active', true)
        .eq('low_stock_alert_enabled', true);

      if (error) {
        console.error('Error fetching medications for low stock check:', error);
        return;
      }

      if (!activeMeds || activeMeds.length === 0) return;

      for (const med of activeMeds) {
        if (med.tablet_count === null || med.tablet_count === undefined) continue;
        const tabletsPerDay = med.frequency === 'once_daily' ? 1 : med.frequency === 'twice_daily' ? 2 : med.frequency === 'thrice_daily' ? 3 : 1;
        const daysRemaining = Math.floor(med.tablet_count / tabletsPerDay);

        if (daysRemaining <= 3) {
          const message = `⚠️ Your medication stock for <b>${escapeHTML(med.drug_name)}</b> is running low.\n\nOnly ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} remaining (${med.tablet_count} tablets left).\n\nPlease refill your medicine soon.`;
          
          const inlineKeyboard = {
            inline_keyboard: [
              [
                { text: '✅ Bought', callback_data: `${CALLBACK_ACTIONS.REFILL_BOUGHT}:${med.id}` },
                { text: '❌ Stop Reminders', callback_data: `${CALLBACK_ACTIONS.REFILL_STOP}:${med.id}` }
              ]
            ]
          };

          try {
            await bot.sendMessage(med.telegram_id, message, { parse_mode: 'HTML', reply_markup: inlineKeyboard });
            await delay(200);
          } catch (err) {
            console.error(`Failed to send low stock alert for med ${med.id}:`, err);
          }
        }
      }
    } catch (err) {
      console.error('Low stock alert error:', err);
    }
  }, {
    timezone: "Asia/Kolkata"
  });

  // 4. Morning Patient Summary - Every morning at 7:00 AM Asia/Kolkata
  cron.schedule('0 7 * * *', async () => {
    try {
      console.log('[Scheduler] Generating Morning Summaries at 7:00 AM Asia/Kolkata...');
      
      const { data: meds, error } = await supabase
        .from('medications')
        .select('*')
        .eq('active', true);

      if (error) {
        console.error('[Scheduler] Error fetching active medications for morning summary:', error);
        return;
      }

      if (!meds || meds.length === 0) return;

      // Group medications by telegram_id
      const userMeds = {};
      meds.forEach(med => {
        if (!userMeds[med.telegram_id]) {
          userMeds[med.telegram_id] = [];
        }
        userMeds[med.telegram_id].push(med);
      });

      const format12Hour = (timeStr) => {
        const [hourStr, minStr] = timeStr.split(':');
        const hour = parseInt(hourStr);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour % 12 === 0 ? 12 : hour % 12;
        return `${displayHour}:${minStr} ${ampm}`;
      };

      for (const [telegramId, patientMeds] of Object.entries(userMeds)) {
        // Flatten reminder times
        const dayReminders = [];
        patientMeds.forEach(med => {
          if (Array.isArray(med.reminder_times)) {
            med.reminder_times.forEach(timeStr => {
              dayReminders.push({
                time: timeStr,
                drug_name: med.drug_name,
                dosage: med.dosage
              });
            });
          }
        });

        if (dayReminders.length === 0) continue;

        // Sort chronologically
        dayReminders.sort((a, b) => a.time.localeCompare(b.time));

        let message = `🌅 <b>Today's Medications</b>\n\n`;
        dayReminders.forEach(r => {
          const dosageStr = r.dosage ? ` (${escapeHTML(r.dosage)})` : '';
          message += `💊 ${escapeHTML(r.drug_name)}${dosageStr} → ${format12Hour(r.time)}\n`;
        });

        try {
          await bot.sendMessage(telegramId, message, { parse_mode: 'HTML' });
          await delay(200);
        } catch (sendErr) {
          console.error(`[Scheduler] Failed to send morning summary to patient ${telegramId}:`, sendErr);
        }
      }
    } catch (err) {
      console.error('[Scheduler] Morning summary error:', err);
    }
  }, {
    timezone: "Asia/Kolkata"
  });

  // 5. Daily Caregiver Summary - Every night at 9:30 PM Asia/Kolkata
  cron.schedule('30 21 * * *', async () => {
    try {
      console.log('[Scheduler] Generating Daily Caregiver Summaries at 9:30 PM Asia/Kolkata...');
      
      // 1. Fetch all active patient IDs
      const { data: meds, error: medsErr } = await supabase
        .from('medications')
        .select('telegram_id')
        .eq('active', true);

      if (medsErr) {
        console.error('[Scheduler] Error fetching active patient meds for caregiver summary:', medsErr);
        return;
      }

      if (!meds || meds.length === 0) return;

      const activePatientIds = [...new Set(meds.map(m => m.telegram_id))];

      // 2. Fetch active caregiver links for these patients via the unified compatibility
      //    view (caregiver_connections + legacy), so caregivers linked through the new flow
      //    receive the summary. The legacy caregiver_info table no longer stores relationships.
      const { data: links, error: linkErr } = await supabase
        .from('active_caregiver_links')
        .select('caregiver_chat_id, caregiver_name, patient_telegram_id, connection_status, is_active')
        .eq('is_active', true)
        .eq('connection_status', 'ACCEPTED')
        .in('patient_telegram_id', activePatientIds);

      if (linkErr) {
        console.error('[Scheduler] Error fetching caregiver links for summary:', linkErr);
        return;
      }

      if (!links || links.length === 0) return;

      // 3. For each link, compile adherence stats and low stock alerts
      const startOfToday = moment().tz('Asia/Kolkata').startOf('day').toISOString();

      for (const link of links) {
        // Fetch logs for this patient today
        const { data: todayLogs, error: logsErr } = await supabase
          .from('reminder_logs')
          .select('response')
          .eq('telegram_id', link.patient_telegram_id)
          .gte('scheduled_time', startOfToday);

        if (logsErr) {
          console.error(`[Scheduler] Error fetching logs for patient ${link.patient_telegram_id}:`, logsErr);
          continue;
        }

        let takenCount = 0;
        let skippedCount = 0;
        let missedCount = 0;

        if (todayLogs) {
          todayLogs.forEach(log => {
            if (log.response === 'TAKEN') takenCount++;
            else if (log.response === 'SKIP') skippedCount++;
            else if (log.response === 'MISSED') missedCount++;
          });
        }

        // Fetch patient meds to check for low stock
        const { data: patientMeds, error: patMedsErr } = await supabase
          .from('medications')
          .select('*')
          .eq('telegram_id', link.patient_telegram_id)
          .eq('active', true);

        if (patMedsErr) {
          console.error(`[Scheduler] Error fetching medications for patient ${link.patient_telegram_id}:`, patMedsErr);
          continue;
        }

        const lowStockMeds = [];
        if (patientMeds) {
          patientMeds.forEach(med => {
            if (med.tablet_count === null || med.tablet_count === undefined) return;
            const tabletsPerDay = med.frequency === 'once_daily' ? 1 : med.frequency === 'twice_daily' ? 2 : med.frequency === 'thrice_daily' ? 3 : 1;
            const daysRemaining = Math.floor(med.tablet_count / tabletsPerDay);
            if (daysRemaining <= 3) {
              lowStockMeds.push({
                drug_name: med.drug_name,
                daysRemaining
              });
            }
          });
        }

        // Get patient name
        let patientName = 'Patient';
        try {
          const chatInfo = await bot.getChat(link.patient_telegram_id);
          patientName = `${chatInfo.first_name || ''} ${chatInfo.last_name || ''}`.trim() || 'Patient';
        } catch (chatErr) {}

        // Format message
        let summaryMessage = `📊 <b>Daily Adherence Summary</b>\n`;
        summaryMessage += `Patient: <b>${escapeHTML(patientName)}</b>\n\n`;
        summaryMessage += `✅ Taken: ${takenCount}\n`;
        summaryMessage += `⏭ Skipped: ${skippedCount}\n`;
        summaryMessage += `❌ Missed: ${missedCount}\n`;

        if (lowStockMeds.length > 0) {
          summaryMessage += `\n⚠️ <b>Low Stock Alert:</b>\n`;
          lowStockMeds.forEach(med => {
            summaryMessage += `• ${escapeHTML(med.drug_name)} (Only ${med.daysRemaining} days remaining)\n`;
          });
        }

        try {
          await bot.sendMessage(link.caregiver_chat_id, summaryMessage, { parse_mode: 'HTML' });
          await delay(200);
        } catch (sendErr) {
          console.error(`[Scheduler] Failed to send daily summary to caregiver ${link.caregiver_chat_id}:`, sendErr);
        }
      }
    } catch (err) {
      console.error('[Scheduler] Daily caregiver summary error:', err);
    }
  }, {
    timezone: "Asia/Kolkata"
  });
};

module.exports = {
  initScheduler
};
