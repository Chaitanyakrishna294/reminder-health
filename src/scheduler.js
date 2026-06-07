const cron = require('node-cron');
const moment = require('moment-timezone');
const { bot } = require('./bot');
const { supabase } = require('./db');
const { delay, calculateNextReminder, escapeHTML, activeSnoozes } = require('./utils');
const { CALLBACK_ACTIONS, MAX_SNOOZES } = require('./constants');

const initScheduler = () => {
  console.log('⏰ Schedulers initialized.');

  // 1. Every Minute Reminder Checker
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      
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
              reminder_status: 'PENDING_PATIENT',
              retry_count: 0,
              snooze_count: currentSnoozes,
              retry_reminder_at: retryReminderAt
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
                  const nextReminder = calculateNextReminder(med.reminder_times);
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

            console.log(`[Workflow State Change] Created reminder_event ID ${eventData[0].id} for Med ID ${med.id} with status 'PENDING_PATIENT'`);
            console.log(`[Scheduler] Sending Telegram message for Med ID: ${med.id}`);
            // 3. Send Reminder
            await bot.sendMessage(med.telegram_id, message, { parse_mode: 'HTML', reply_markup: inlineKeyboard });

            // 4. Calculate next reminder from the JSONB array
            const nextReminder = calculateNextReminder(med.reminder_times);

            console.log(`[Scheduler] Updating next_reminder_at for Med ID: ${med.id} to ${nextReminder.toISOString()}`);
            // 5. Update record with next_reminder_at, reset old retry columns
            await supabase
              .from('medications')
              .update({
                next_reminder_at: nextReminder.toISOString(),
                last_reminder_scheduled_at: med.next_reminder_at,
                retry_reminder_at: null,
                retry_count: 0
              })
              .eq('id', med.id);

            // 6. Add a small delay between sends to avoid Telegram API flood limits
            await delay(200);

          } catch (sendErr) {
            console.error(`[Scheduler] Failed to send reminder to ${med.telegram_id}:`, sendErr);
            
            // Retry once logic
            try {
              await delay(1000);
              await bot.sendMessage(med.telegram_id, message, { parse_mode: 'HTML', reply_markup: inlineKeyboard });
              const nextReminder = calculateNextReminder(med.reminder_times);
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

      // 1.5. Checking for pending retries / snoozes in reminder_events
      console.log(`[Scheduler] Checking for pending retries/snoozes in reminder_events at ${now.toISOString()}...`);

      const { data: activeEvents, error: retryError } = await supabase
        .from('reminder_events')
        .select(`
          *,
          medications:medication_id (
            *
          )
        `)
        .in('reminder_status', ['PENDING_PATIENT', 'RETRYING_PATIENT', 'SNOOZED'])
        .lte('retry_reminder_at', now.toISOString());

      if (retryError) {
        console.error('[Scheduler] Error fetching retry reminder events:', retryError);
      } else if (activeEvents && activeEvents.length > 0) {
        console.log(`[Scheduler] Found ${activeEvents.length} active events for retry/snooze check.`);
        for (const event of activeEvents) {
          const med = event.medications;
          if (!med || !med.active) {
            console.log(`[Scheduler] Skipping event ${event.id} because medication configuration is missing or inactive.`);
            continue;
          }

          // Safety check: skip if next reminder has already become due/past to prevent retry overlap
          const nextReminderTime = new Date(med.next_reminder_at);
          if (nextReminderTime <= now) {
            console.log(`[Scheduler] Skipping retry for Event ID: ${event.id} because next_reminder_at is already in the past or now.`);
            continue;
          }

          // Case A: Firing Snooze
          if (event.reminder_status === 'SNOOZED') {
            const nextRetryInterval = med.priority_level === 'critical' ? 5 : 15;
            const retryReminderAt = new Date(Date.now() + nextRetryInterval * 60 * 1000).toISOString();

            try {
              // Optimistic lock update on reminder_events
              const { data: updateData, error: updateErr } = await supabase
                .from('reminder_events')
                .update({
                  reminder_status: 'PENDING_PATIENT',
                  retry_reminder_at: retryReminderAt,
                  retry_count: 0
                })
                .eq('id', event.id)
                .eq('reminder_status', 'SNOOZED')
                .select();

              if (updateErr || !updateData || updateData.length === 0) {
                console.log(`[Scheduler] Snoozed event ${event.id} already processed. Skipping.`);
                continue;
              }

              console.log(`[Workflow State Change] Snooze expired for Event ID ${event.id}. Transitioned status from SNOOZED to PENDING_PATIENT`);
              console.log(`[Scheduler] Snooze expired. Sending Telegram reminder for Med ID: ${med.id}`);
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
              await bot.sendMessage(med.telegram_id, message, { parse_mode: 'HTML', reply_markup: inlineKeyboard });
              await delay(200);
            } catch (snoozeErr) {
              console.error(`[Scheduler] Failed to send snooze expiration to ${med.telegram_id}:`, snoozeErr);
            }
            continue;
          }

          // Case B: Retrying Patient
          const retryLimit = med.priority_level === 'critical' ? 1 : 2;

          // Escalation Branch: Patient missed medication retry limit
          if (event.retry_count >= retryLimit) {
            try {
              // Lock the record atomically to prevent duplicate caregiver alerts
              const { data: updateData, error: updateErr } = await supabase
                .from('reminder_events')
                .update({
                  reminder_status: 'ESCALATED_TO_CG',
                  escalated_at: now.toISOString(),
                  retry_reminder_at: null,
                  retry_count: 0
                })
                .eq('id', event.id)
                .eq('reminder_status', event.reminder_status)
                .select();

              if (updateErr || !updateData || updateData.length === 0) {
                console.log(`[Scheduler] Event ${event.id} was already escalated or updated. Skipping.`);
                continue;
              }

              console.log(`[Workflow State Change] Event ID ${event.id} retry limit reached. Transitioned status from ${event.reminder_status} to ESCALATED_TO_CG`);
              console.log(`[Scheduler] Patient missed retry limit. Fetching caregivers for Med ID: ${med.id}`);
              
              // Fetch active caregivers for this patient
              const { data: caregivers, error: cgErr } = await supabase
                .from('caregiver_info')
                .select('caregiver_chat_id')
                .eq('patient_telegram_id', med.telegram_id)
                .eq('connection_status', 'ACCEPTED')
                .eq('is_active', true);

              if (cgErr) throw cgErr;

              if (caregivers && caregivers.length > 0) {
                // Fetch patient name dynamically from Telegram
                let patientName = 'Patient';
                try {
                  const chatInfo = await bot.getChat(med.telegram_id);
                  patientName = `${chatInfo.first_name || ''} ${chatInfo.last_name || ''}`.trim() || 'Patient';
                } catch (chatErr) {
                  console.error('[Scheduler] Failed to get patient chat details:', chatErr);
                }

                const formattedTime = moment(event.scheduled_for)
                  .tz('Asia/Kolkata')
                  .format('h:mm A');

                const priorityEmoji = med.priority_level === 'critical' ? '🔴 CRITICAL' : med.priority_level === 'important' ? '🟠 IMPORTANT' : '🟢 NORMAL';
                const alertMessage = `⚠️ <b>Medication Alert (${priorityEmoji})</b>\n\nPatient: <b>${escapeHTML(patientName)}</b>\n💊 <b>${escapeHTML(med.drug_name)}</b>\n⏰ <b>${formattedTime}</b>`;

                const scheduledTimeMs = new Date(event.scheduled_for).getTime();
                const alertButtons = {
                  inline_keyboard: [
                    [
                      { text: '✅ Mark Taken', callback_data: `${CALLBACK_ACTIONS.CG_TAKEN}:${med.id}:${scheduledTimeMs}` },
                      { text: '⏭ Mark Skip', callback_data: `${CALLBACK_ACTIONS.CG_SKIP}:${med.id}:${scheduledTimeMs}` }
                    ]
                  ]
                };

                for (const cg of caregivers) {
                  try {
                    await bot.sendMessage(cg.caregiver_chat_id, alertMessage, { parse_mode: 'HTML', reply_markup: alertButtons });
                    console.log(`[Scheduler] Sent missed dose alert to Caregiver: ${cg.caregiver_chat_id}`);
                  } catch (sendErr) {
                    console.error(`[Scheduler] Failed to send alert to caregiver ${cg.caregiver_chat_id}:`, sendErr);
                  }
                }

                // Update event to indicate caregiver has been notified
                await supabase
                  .from('reminder_events')
                  .update({ caregiver_notified: true })
                  .eq('id', event.id);
              }
            } catch (err) {
              console.error(`[Scheduler] Error during caregiver alert processing for Event ID ${event.id}:`, err);
            }
            continue;
          }

          // Retry branch: within limits
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

          const message = `⏰ Reminder Again:\nPlease take your medicine.`;

          try {
            // Optimistic lock update on reminder_events
            const nextRetryInterval = med.priority_level === 'critical' ? 5 : 15;
            const { data: updateData, error: updateErr } = await supabase
              .from('reminder_events')
              .update({
                reminder_status: 'RETRYING_PATIENT',
                retry_reminder_at: new Date(Date.now() + nextRetryInterval * 60 * 1000).toISOString(),
                retry_count: event.retry_count + 1
              })
              .eq('id', event.id)
              .eq('reminder_status', event.reminder_status)
              .select();

            if (updateErr || !updateData || updateData.length === 0) {
              console.log(`[Scheduler] Event ${event.id} retry already processed. Skipping.`);
              continue;
            }

            console.log(`[Workflow State Change] Event ID ${event.id} is being retried. Transitioned status from ${event.reminder_status} to RETRYING_PATIENT (retry_count: ${event.retry_count + 1})`);
            console.log(`[Scheduler] Sending Telegram retry message for Med ID: ${med.id}`);
            await bot.sendMessage(med.telegram_id, message, { parse_mode: 'HTML', reply_markup: inlineKeyboard });
            await delay(200); // flood limit delay
          } catch (sendErr) {
            console.error(`[Scheduler] Failed to send retry to ${med.telegram_id}:`, sendErr);
          }
        }
      }

      // 1.7. Check for unresolved caregiver notifications (Missed / Emergency Escalations)
      console.log(`[Scheduler] Checking for unresolved caregiver notifications at ${now.toISOString()}...`);
      
      const { data: pendingEscalations, error: escError } = await supabase
        .from('reminder_events')
        .select(`
          *,
          medications:medication_id (
            *
          )
        `)
        .eq('reminder_status', 'ESCALATED_TO_CG');

      if (!escError && pendingEscalations && pendingEscalations.length > 0) {
        console.log(`[Scheduler] Found ${pendingEscalations.length} medication events waiting for caregiver action.`);
        for (const event of pendingEscalations) {
          const med = event.medications;
          if (!med || !med.active) continue;

          const escalationTime = event.escalated_at ? new Date(event.escalated_at) : new Date(event.scheduled_for);
          const elapsedMinutes = Math.floor((now.getTime() - escalationTime.getTime()) / 60000);
          
          // Timeout limit: 15 minutes for critical, 60 minutes for other priorities
          const timeoutLimit = med.priority_level === 'critical' ? 15 : 60;

          if (elapsedMinutes >= timeoutLimit) {
            try {
              // Lock the record atomically to prevent concurrent resolutions
              const { data: updateData, error: updateErr } = await supabase
                .from('reminder_events')
                .update({
                  reminder_status: 'MISSED',
                  resolved_at: now.toISOString(),
                  resolved_by: 'SYSTEM',
                  retry_reminder_at: null,
                  retry_count: 0
                })
                .eq('id', event.id)
                .eq('reminder_status', 'ESCALATED_TO_CG')
                .select();

              if (updateErr || !updateData || updateData.length === 0) {
                console.log(`[Scheduler] Event ${event.id} was already resolved. Skipping auto-MISSED.`);
                continue;
              }

              console.log(`[Workflow State Change] Event ID ${event.id} caregiver response timed out (${elapsedMinutes}m). Transitioned status from ESCALATED_TO_CG to MISSED`);
              console.log(`[Scheduler] Event ${event.id} caregiver response timed out (${elapsedMinutes}m). Auto-logging MISSED.`);

              // 1. Log MISSED in reminder_logs
              const formattedScheduledTime = new Date(event.scheduled_for).toISOString();
              await supabase.from('reminder_logs').insert([{
                telegram_id: med.telegram_id,
                medication_id: med.id,
                scheduled_time: formattedScheduledTime,
                response: 'MISSED'
              }]);

              // 2. Notify patient
              try {
                await bot.sendMessage(med.telegram_id, `❌ You missed your medication: <b>${escapeHTML(med.drug_name)}</b>.`, { parse_mode: 'HTML' });
              } catch (err) {
                console.error(`[Scheduler] Failed to notify patient ${med.telegram_id} of missed dose:`, err);
              }

              // 3. If critical, send emergency escalation warning to caregiver
              if (med.priority_level === 'critical') {
                const { data: caregivers } = await supabase
                  .from('caregiver_info')
                  .select('caregiver_chat_id')
                  .eq('patient_telegram_id', med.telegram_id)
                  .eq('connection_status', 'ACCEPTED')
                  .eq('is_active', true);

                if (caregivers && caregivers.length > 0) {
                  let patientName = 'Patient';
                  try {
                    const chatInfo = await bot.getChat(med.telegram_id);
                    patientName = `${chatInfo.first_name || ''} ${chatInfo.last_name || ''}`.trim() || 'Patient';
                  } catch (chatErr) {}

                  const alertMsg = `⚠️ <b>CRITICAL ESCALATION</b>\n\nPatient <b>${escapeHTML(patientName)}</b> did NOT take their critical medication:\n💊 <b>${escapeHTML(med.drug_name)}</b>\n\n⚠️ <b>Please check on the patient immediately.</b>`;
                  
                  for (const cg of caregivers) {
                    try {
                      await bot.sendMessage(cg.caregiver_chat_id, alertMsg, { parse_mode: 'HTML' });
                      console.log(`[Scheduler] Sent critical escalation alert to Caregiver: ${cg.caregiver_chat_id}`);
                    } catch (cgSendErr) {
                      console.error(`Failed to send emergency alert to caregiver ${cg.caregiver_chat_id}:`, cgSendErr);
                    }
                  }
                }
              }
            } catch (pErr) {
              console.error(`[Scheduler] Error auto-logging MISSED for Event ID ${event.id}:`, pErr);
            }
          }
        }
      }
    } catch (err) {
      console.error('Scheduler error:', err);
    }
  });

  // 2. Weekly Summary - Sundays at 8 PM (20:00) server time
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

      // 2. Fetch active caregiver links for these patients
      const { data: links, error: linkErr } = await supabase
        .from('caregiver_info')
        .select('*')
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
