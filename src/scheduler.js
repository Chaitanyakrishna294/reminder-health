const cron = require('node-cron');
const moment = require('moment-timezone');
const { bot } = require('./bot');
const { supabase } = require('./db');
const { delay, calculateNextReminder, activeSnoozes } = require('./utils');
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

      console.log(`[Scheduler] Found ${dueMedications ? dueMedications.length : 0} due reminders.`);

      if (!dueMedications || dueMedications.length === 0) return;

      for (const med of dueMedications) {
        console.log(`[Scheduler] Processing reminder for Med ID: ${med.id}, Last Sent: ${med.last_sent_at || 'Never'}`);

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

        // Reset snooze counter if this is a fresh regular reminder cycle
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

        const message = `💊 Time to take ${med.drug_name} ${med.dosage || ''}`;

        try {
          console.log(`[Scheduler] IMMEDIATELY updating last_sent_at for Med ID: ${med.id}`);
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

          console.log(`[Scheduler] Sending Telegram message for Med ID: ${med.id}`);
          // 2. Send Reminder
          await bot.sendMessage(med.telegram_id, message, { reply_markup: inlineKeyboard });

          // 3. Calculate next reminder from the JSONB array
          const nextReminder = calculateNextReminder(med.reminder_times);

          console.log(`[Scheduler] Updating next_reminder_at for Med ID: ${med.id} to ${nextReminder.toISOString()}`);
          // 4. Update record with new next_reminder_at, reset retry count, and set last scheduled reminder
          await supabase
            .from('medications')
            .update({
              next_reminder_at: nextReminder.toISOString(),
              last_reminder_scheduled_at: med.next_reminder_at,
              retry_count: 0
            })
            .eq('id', med.id);

          // 5. Add a small delay between sends to avoid Telegram API flood limits
          await delay(200);

        } catch (sendErr) {
          console.error(`[Scheduler] Failed to send reminder to ${med.telegram_id}:`, sendErr);
          
          // Retry once logic could be added here
          try {
            await delay(1000);
            await bot.sendMessage(med.telegram_id, message, { reply_markup: inlineKeyboard });
            const nextReminder = calculateNextReminder(med.reminder_times);
            await supabase
              .from('medications')
              .update({
                next_reminder_at: nextReminder.toISOString(),
                last_reminder_scheduled_at: med.next_reminder_at,
                retry_count: 0
              })
              .eq('id', med.id);
          } catch (retryErr) {
            console.error(`[Scheduler] Retry failed for ${med.telegram_id}:`, retryErr);
          }
        }
      }

      // 1.5. Checking for pending retries
      console.log(`[Scheduler] Checking for pending retries at ${now.toISOString()}...`);
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

      const { data: retryMedications, error: retryError } = await supabase
        .from('medications')
        .select('*')
        .eq('active', true)
        .not('last_reminder_scheduled_at', 'is', null)
        .lt('retry_count', 2)
        .lte('last_sent_at', fifteenMinutesAgo);

      if (retryError) {
        console.error('[Scheduler] Error fetching retry medications:', retryError);
      } else if (retryMedications && retryMedications.length > 0) {
        console.log(`[Scheduler] Found ${retryMedications.length} pending retries.`);
        for (const med of retryMedications) {
          // Safety check: skip if next reminder has already become due/past to prevent retry overlap
          const nextReminderTime = new Date(med.next_reminder_at);
          if (nextReminderTime <= now) {
            console.log(`[Scheduler] Skipping retry for Med ID: ${med.id} because next_reminder_at is already in the past or now.`);
            continue;
          }

          console.log(`[Scheduler] Processing retry for Med ID: ${med.id}, Retry Count: ${med.retry_count}`);

          const scheduledTimeMs = new Date(med.last_reminder_scheduled_at).getTime();
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

          const message = `⏰ Reminder Again:\nPlease take your medicine.`;

          try {
            // Optimistic lock update for retry
            let lockQuery = supabase
              .from('medications')
              .update({
                last_sent_at: now.toISOString(),
                retry_count: med.retry_count + 1
              })
              .eq('id', med.id)
              .eq('last_sent_at', med.last_sent_at);

            const { data: lockData, error: lockErr } = await lockQuery.select();

            if (lockErr || !lockData || lockData.length === 0) {
              console.log(`[Scheduler] Med ID ${med.id} retry was already locked/updated. Skipping.`);
              continue;
            }

            console.log(`[Scheduler] Sending Telegram retry message for Med ID: ${med.id}`);
            await bot.sendMessage(med.telegram_id, message, { reply_markup: inlineKeyboard });
            await delay(200); // flood limit delay
          } catch (sendErr) {
            console.error(`[Scheduler] Failed to send retry to ${med.telegram_id}:`, sendErr);
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

        let summaryMessage = "📊 Weekly Health Summary\n\n";
        for (const [drug, data] of Object.entries(stats)) {
          const percentage = Math.round((data.taken / data.total) * 100);
          summaryMessage += `${drug} → ${data.taken}/${data.total} doses (${percentage}%)\n`;
        }
        summaryMessage += "\nKeep going 💪";

        try {
          await bot.sendMessage(telegramId, summaryMessage);
          await delay(200); // Flood control
        } catch (err) {
          console.error(`Error sending weekly summary to ${telegramId}:`, err);
        }
      }

    } catch (err) {
      console.error('Weekly summary error:', err);
    }
  });

  // 3. Daily Low Stock Alert - Every day at 9:00 AM
  cron.schedule('0 9 * * *', async () => {
    try {
      console.log('📦 Checking for low stock medications...');
      
      const { data: lowStockMeds, error } = await supabase
        .from('medications')
        .select('*')
        .eq('active', true)
        .eq('low_stock_alert_enabled', true)
        .lte('tablet_count', 5);

      if (error) {
        console.error('Error fetching low stock medications:', error);
        return;
      }

      if (!lowStockMeds || lowStockMeds.length === 0) return;

      for (const med of lowStockMeds) {
        const message = `⚠️ Your medication stock for ${med.drug_name} is running low.\n\nOnly ${med.tablet_count} tablets remaining.\n\nPlease refill your medicine soon.`;
        
        const inlineKeyboard = {
          inline_keyboard: [
            [
              { text: '✅ Bought', callback_data: `${CALLBACK_ACTIONS.REFILL_BOUGHT}:${med.id}` },
              { text: '❌ Stop Reminders', callback_data: `${CALLBACK_ACTIONS.REFILL_STOP}:${med.id}` }
            ]
          ]
        };

        try {
          await bot.sendMessage(med.telegram_id, message, { reply_markup: inlineKeyboard });
          await delay(200);
        } catch (err) {
          console.error(`Failed to send low stock alert for med ${med.id}:`, err);
        }
      }
    } catch (err) {
      console.error('Low stock alert error:', err);
    }
  });
};

module.exports = {
  initScheduler
};
