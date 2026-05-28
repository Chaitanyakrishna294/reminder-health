const { bot } = require('./bot');
const { supabase } = require('./db');
const moment = require('moment-timezone');
const { STATES, FREQUENCIES, CALLBACK_ACTIONS, MAIN_MENU, MAX_SNOOZES, SNOOZE_MINUTES } = require('./constants');
const { isValidTime, calculateNextReminder, escapeHTML, activeSnoozes } = require('./utils');

const userStates = {};

const calculateStreak = (logs) => {
  if (!logs || logs.length === 0) return 0;

  const days = {};
  logs.forEach(log => {
    const dateStr = moment(log.scheduled_time).tz('Asia/Kolkata').format('YYYY-MM-DD');
    if (!days[dateStr]) {
      days[dateStr] = { total: 0, taken: 0 };
    }
    days[dateStr].total += 1;
    if (log.response === 'TAKEN') {
      days[dateStr].taken += 1;
    }
  });

  let streak = 0;
  const baseMoment = moment().tz('Asia/Kolkata');
  
  const todayStr = baseMoment.format('YYYY-MM-DD');
  const todayData = days[todayStr];

  const cursor = baseMoment.clone().subtract(1, 'day');
  const yesterdayStr = cursor.format('YYYY-MM-DD');
  const yesterdayData = days[yesterdayStr];

  if (yesterdayData && yesterdayData.taken === yesterdayData.total && yesterdayData.total > 0) {
    streak = 1;
    
    cursor.subtract(1, 'day');
    let dayCount = 2;
    while (dayCount <= 30) {
      const prevDateStr = cursor.format('YYYY-MM-DD');
      const prevData = days[prevDateStr];
      if (prevData && prevData.total > 0) {
        if (prevData.taken === prevData.total) {
          streak++;
          cursor.subtract(1, 'day');
          dayCount++;
        } else {
          break;
        }
      } else {
        cursor.subtract(1, 'day');
        dayCount++;
      }
    }
    
    if (todayData && todayData.total > 0 && todayData.taken === todayData.total) {
      streak++;
    }
  } else if (todayData && todayData.total > 0 && todayData.taken === todayData.total) {
    streak = 1;
  }

  return streak;
};

const mainMenuKeyboard = {
  reply_markup: {
    keyboard: [
      [ { text: MAIN_MENU.ADD_MED }, { text: MAIN_MENU.MY_LOGS } ],
      [ { text: MAIN_MENU.STATS }, { text: MAIN_MENU.TODAYS_MEDS } ],
      [ { text: MAIN_MENU.MANAGE }, { text: MAIN_MENU.CAREGIVER } ]
    ],
    resize_keyboard: true,
    is_persistent: true,
    one_time_keyboard: false
  }
};
const sendMainMenu = async (chatId, text) => {
  await bot.sendMessage(chatId, text, mainMenuKeyboard);
};

// ========================
// Action Handlers
// ========================

const handleCancel = async (chatId) => {
  delete userStates[chatId];
  await sendMainMenu(chatId, 'Action cancelled. Returning to main menu.');
};

const handleSnoozeInfo = async (chatId) => {
  await bot.sendMessage(chatId, 'To snooze a medication, please tap the "⏰ Snooze 10m" button directly on your reminder message!');
};

const handleAddMed = async (chatId) => {
  userStates[chatId] = { step: STATES.DRUG_NAME };
  await bot.sendMessage(chatId, '➕ Let\'s add a new medication.\n\nWhat is the name of the medicine? (e.g., Metformin)');
};

const handleCaregiver = async (chatId) => {
  try {
    const { data: caregiverRecords, error } = await supabase
      .from('caregiver_info')
      .select('*')
      .eq('caregiver_chat_id', chatId.toString())
      .eq('is_active', true);

    const inlineKeyboard = {
      inline_keyboard: []
    };

    if (!error && caregiverRecords && caregiverRecords.length > 0) {
      inlineKeyboard.inline_keyboard.push([
        { text: '📊 Caregiver Panel', callback_data: CALLBACK_ACTIONS.CG_PANEL }
      ]);
    }

    inlineKeyboard.inline_keyboard.push([
      { text: '👨‍⚕ Become Caregiver', callback_data: CALLBACK_ACTIONS.CG_BECOME }
    ]);
    inlineKeyboard.inline_keyboard.push([
      { text: '📋 My Caregiver ID', callback_data: CALLBACK_ACTIONS.CG_MY_ID }
    ]);
    inlineKeyboard.inline_keyboard.push([
      { text: '➕ Add Caregiver', callback_data: CALLBACK_ACTIONS.CG_ADD }
    ]);

    await bot.sendMessage(chatId, '👨‍⚕ Caregiver Connection System\n\nChoose an option below:', { reply_markup: inlineKeyboard });
  } catch (err) {
    console.error('[Caregiver] handleCaregiver error:', err);
    await bot.sendMessage(chatId, '❌ Error loading caregiver options.');
  }
};

const handleCaregiverPanel = async (chatId) => {
  try {
    // Find active linkings
    const { data: links, error: linkErr } = await supabase
      .from('caregiver_info')
      .select('*')
      .eq('caregiver_chat_id', chatId.toString())
      .eq('is_active', true)
      .not('patient_telegram_id', 'is', null);

    if (linkErr) throw linkErr;

    if (!links || links.length === 0) {
      await bot.sendMessage(chatId, '📭 You are not linked to any patient yet. Share your Caregiver ID with your patient to get started!');
      return;
    }

    for (const link of links) {
      // Fetch patient meds
      const { data: meds, error: medsErr } = await supabase
        .from('medications')
        .select('*')
        .eq('telegram_id', link.patient_telegram_id)
        .eq('active', true);

      if (medsErr) throw medsErr;

      // Sort meds by priority: critical -> important -> normal
      if (meds) {
        meds.sort((a, b) => {
          const prioMap = { critical: 3, important: 2, normal: 1 };
          const aPrio = prioMap[a.priority_level] || 1;
          const bPrio = prioMap[b.priority_level] || 1;
          return bPrio - aPrio;
        });
      }

      // Fetch today's logs
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const { data: todayLogs, error: todayLogsErr } = await supabase
        .from('reminder_logs')
        .select('*')
        .eq('telegram_id', link.patient_telegram_id)
        .gte('scheduled_time', today.toISOString());

      if (todayLogsErr) throw todayLogsErr;

      // Fetch last 7 days logs for adherence stats
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const { data: weekLogs, error: weekLogsErr } = await supabase
        .from('reminder_logs')
        .select('*')
        .eq('telegram_id', link.patient_telegram_id)
        .gte('scheduled_time', weekAgo.toISOString());

      if (weekLogsErr) throw weekLogsErr;

      const logMap = {};
      if (todayLogs) {
        todayLogs.forEach(l => {
          logMap[l.medication_id] = l.response; // TAKEN, SKIP, or MISSED
        });
      }

      const weekStats = {};
      if (weekLogs) {
        weekLogs.forEach(l => {
          if (!weekStats[l.medication_id]) {
            weekStats[l.medication_id] = { total: 0, taken: 0 };
          }
          weekStats[l.medication_id].total += 1;
          if (l.response === 'TAKEN') {
            weekStats[l.medication_id].taken += 1;
          }
        });
      }

      let report = `👨‍⚕ <b>Caregiver Report</b>\n`;
      report += `👤 <b>Caregiver:</b> ${escapeHTML(link.caregiver_name)}\n`;
      report += `🆔 <b>Patient Chat ID:</b> ${escapeHTML(link.patient_telegram_id)}\n\n`;

      if (!meds || meds.length === 0) {
        report += `⚠️ Patient has no active medications registered.`;
      } else {
        report += `💊 <b>Medication Details &amp; Status:</b>\n\n`;
        meds.forEach(med => {
          let statusEmoji = '⏳ Pending';
          if (logMap[med.id]) {
            if (logMap[med.id] === 'TAKEN') statusEmoji = '✅ TAKEN';
            else if (logMap[med.id] === 'SKIP') statusEmoji = '⏭ SKIP';
            else if (logMap[med.id] === 'MISSED') statusEmoji = '❌ MISSED';
          }
          
          const nextDate = new Date(med.next_reminder_at);
          const nextTimeStr = moment(med.next_reminder_at).tz('Asia/Kolkata').format('h:mm A');
          
          const tabletsPerDay = med.frequency === 'once_daily' ? 1 : med.frequency === 'twice_daily' ? 2 : med.frequency === 'thrice_daily' ? 3 : 1;
          const daysRemaining = Math.floor(med.tablet_count / tabletsPerDay);
          const isLowStock = daysRemaining <= 3;
          const stockStatus = isLowStock 
            ? `⚠️ LOW STOCK (Only ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} remaining)` 
            : `Stock: ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} remaining (${med.tablet_count} left)`;

          // Weekly adherence
          let adherenceStr = 'N/A';
          if (weekStats[med.id] && weekStats[med.id].total > 0) {
            const pct = Math.round((weekStats[med.id].taken / weekStats[med.id].total) * 100);
            adherenceStr = `${pct}% (${weekStats[med.id].taken}/${weekStats[med.id].total})`;
          }

          const priorityEmoji = med.priority_level === 'critical' ? '🔴' : med.priority_level === 'important' ? '🟠' : '🟢';
          report += `• ${priorityEmoji} <b>${escapeHTML(med.drug_name)}</b> (${escapeHTML(med.dosage) || 'N/A'})\n`;
          report += `  - Today's Status: ${statusEmoji}\n`;
          report += `  - Next Reminder: ${nextTimeStr}\n`;
          report += `  - ${stockStatus}\n`;
          report += `  - 7-Day Adherence: ${adherenceStr}\n\n`;
        });

        // Today's Timeline View
        let timelineText = '';
        if (todayLogs && todayLogs.length > 0) {
          todayLogs.sort((a, b) => a.scheduled_time.localeCompare(b));
          todayLogs.forEach(log => {
            const timeStr = moment(log.scheduled_time).tz('Asia/Kolkata').format('hh:mm A');
            let statusEmojiStr = '⏳ Pending';
            if (log.response === 'TAKEN') statusEmojiStr = '✅ Taken';
            else if (log.response === 'SKIP') statusEmojiStr = '⏭ Skipped';
            else if (log.response === 'MISSED') statusEmojiStr = '❌ Missed';

            const delayStr = log.response === 'TAKEN' && log.delay_minutes && log.delay_minutes > 5 ? ` (${log.delay_minutes}m late)` : '';
            const medName = meds.find(m => m.id === log.medication_id)?.drug_name || 'Medication';

            timelineText += `• ${timeStr} → ${statusEmojiStr}${delayStr} (${escapeHTML(medName)})\n`;
          });
        } else {
          timelineText = 'No activity logged yet today.\n';
        }

        report += `🕒 <b>Today's Timeline:</b>\n\n${timelineText}`;
      }
      
      await bot.sendMessage(chatId, report, { parse_mode: 'HTML' });
    }
  } catch (err) {
    console.error('[Caregiver Panel] Error:', err);
    await bot.sendMessage(chatId, '❌ Error loading Caregiver Panel. Please try again.');
  }
};

const handleTodaysMeds = async (chatId) => {
  try {
    const { data: meds, error: medsError } = await supabase.from('medications').select('*').eq('telegram_id', chatId.toString()).eq('active', true);
    if (medsError) throw medsError;

    if (!meds || meds.length === 0) {
      await bot.sendMessage(chatId, "You have no active medications.");
      return;
    }

    const moment = require('moment-timezone');
    const today = moment()
      .tz('Asia/Kolkata')
      .startOf('day')
      .toDate();
    const { data: logs, error: logsError } = await supabase.from('reminder_logs').select('medication_id, response').eq('telegram_id', chatId.toString()).gte('scheduled_time', today.toISOString());
    if (logsError) throw logsError;

    const loggedMeds = {};
    if (logs) {
      logs.forEach(l => loggedMeds[l.medication_id] = l.response);
    }

    let scheduleText = "💊 Today's Medications\n\n";
    for (const med of meds) {
      const status = loggedMeds[med.id] ? (loggedMeds[med.id] === 'TAKEN' ? '✅ Logged' : '⏭ Skipped') : '⏳ Pending';
      const nextDate = new Date(med.next_reminder_at);
      let timeString = nextDate.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit'
      });
      scheduleText += `${med.drug_name} ${med.dosage || ''} → ${timeString} [${status}]\n`;
    }

    await bot.sendMessage(chatId, scheduleText);
  } catch (err) {
    console.error(err);
    await bot.sendMessage(chatId, '❌ Error fetching schedule.');
  }
};

const handleMyLogs = async (chatId) => {
  try {
    const moment = require('moment-timezone');
    const today = moment()
      .tz('Asia/Kolkata')
      .startOf('day')
      .toDate();

    const { data: logs, error: logsError } = await supabase
      .from('reminder_logs')
      .select('response, scheduled_time, medication_id, delay_minutes')
      .eq('telegram_id', chatId.toString())
      .gte('scheduled_time', today.toISOString());

    if (logsError) throw logsError;

    if (!logs || logs.length === 0) {
      await bot.sendMessage(chatId, "No medication activity logged yet today.");
      return;
    }

    const medIds = [...new Set(logs.map(l => l.medication_id))];
    const { data: meds, error: medsError } = await supabase.from('medications').select('id, drug_name').in('id', medIds);
    if (medsError) throw medsError;

    const medMap = {};
    if (meds) meds.forEach(m => medMap[m.id] = m.drug_name);

    let logText = "📝 Today's Activity:\n\n";
    for (const log of logs) {
      const drug = medMap[log.medication_id] || 'Unknown';
      let statusEmoji = '⏳ Pending';
      if (log.response === 'TAKEN') statusEmoji = '✅ TAKEN';
      else if (log.response === 'SKIP') statusEmoji = '⏭ SKIP';
      else if (log.response === 'MISSED') statusEmoji = '❌ MISSED';

      const delayStr = log.response === 'TAKEN' && log.delay_minutes && log.delay_minutes > 5 ? ` (${log.delay_minutes}m late)` : '';
      logText += `${drug} → ${statusEmoji}${delayStr}\n`;
    }

    await bot.sendMessage(chatId, logText);
  } catch (err) {
    console.error(`Error in MY_LOGS for ${chatId}:`, err);
    await bot.sendMessage(chatId, '❌ Could not retrieve logs.');
  }
};

const handleStats = async (chatId) => {
  try {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const { data: logs, error: logsError } = await supabase
      .from('reminder_logs')
      .select('response, medication_id')
      .eq('telegram_id', chatId.toString())
      .gte('scheduled_time', weekAgo.toISOString());

    if (logsError) throw logsError;

    if (!logs || logs.length === 0) {
      await bot.sendMessage(chatId, "No medication activity logged in the past week.");
      return;
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const { data: streakLogs } = await supabase
      .from('reminder_logs')
      .select('response, scheduled_time')
      .eq('telegram_id', chatId.toString())
      .gte('scheduled_time', thirtyDaysAgo.toISOString());

    const streak = calculateStreak(streakLogs);

    const medIds = [...new Set(logs.map(l => l.medication_id))];
    const { data: meds, error: medsError } = await supabase.from('medications').select('id, drug_name').in('id', medIds);
    if (medsError) throw medsError;

    const medMap = {};
    if (meds) meds.forEach(m => medMap[m.id] = m.drug_name);

    const stats = {};
    logs.forEach(log => {
      const drug = medMap[log.medication_id] || 'Unknown';
      if (!stats[drug]) stats[drug] = { total: 0, taken: 0 };
      stats[drug].total += 1;
      if (log.response === 'TAKEN') stats[drug].taken += 1;
    });

    let statsText = `📊 <b>Weekly Adherence Stats</b>:\n\n🔥 <b>Current Streak:</b> ${streak} Days\n\n`;
    for (const [drug, data] of Object.entries(stats)) {
      const percentage = Math.round((data.taken / data.total) * 100);
      statsText += `<b>${escapeHTML(drug)}</b> → ${data.taken}/${data.total} doses (${percentage}%)\n`;
    }

    await bot.sendMessage(chatId, statsText, { parse_mode: 'HTML' });
  } catch (err) {
    console.error(`Error in STATS for ${chatId}:`, err);
    await bot.sendMessage(chatId, '❌ Could not calculate stats.');
  }
};

const handleManage = async (chatId, page = 0) => {
  try {
    const { data: meds, error } = await supabase
      .from('medications')
      .select('*')
      .eq('telegram_id', chatId.toString())
      .eq('active', true)
      .order('id', { ascending: true });
      
    if (error) throw error;
    
    if (!meds || meds.length === 0) {
      await bot.sendMessage(chatId, "You have no active medications to manage.");
      return;
    }
    
    const count = meds.length;
    await bot.sendMessage(chatId, `You have ${count} active medication${count > 1 ? 's' : ''}.`);
    
    const limit = 5;
    const start = page * limit;
    const end = start + limit;
    const pageMeds = meds.slice(start, end);
    
    for (const med of pageMeds) {
      const priorityEmoji = med.priority_level === 'critical' ? '🔴' : med.priority_level === 'important' ? '🟠' : '🟢';
      const timesStr = med.reminder_times ? med.reminder_times.join(', ') : 'N/A';
      const text = `💊 <b>${escapeHTML(med.drug_name)}</b> ${escapeHTML(med.dosage) || ''}\n🔁 ${escapeHTML(med.frequency.replace('_', ' '))}\n⏰ ${escapeHTML(timesStr)}\n📦 Stock: ${med.tablet_count}\n⚠️ Priority: ${priorityEmoji} ${escapeHTML(med.priority_level.toUpperCase())}`;
      const inlineKeyboard = {
        inline_keyboard: [
          [
            { text: '✏️ Edit', callback_data: `${CALLBACK_ACTIONS.MED_EDIT}:${med.id}` },
            { text: '🗑 Delete', callback_data: `${CALLBACK_ACTIONS.MED_DELETE}:${med.id}` }
          ]
        ]
      };
      await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: inlineKeyboard });
    }
    
    const navButtons = [];
    if (page > 0) navButtons.push({ text: '⬅️ Previous', callback_data: `${CALLBACK_ACTIONS.PAGE_PREV}:${page}` });
    if (end < count) navButtons.push({ text: 'Next ➡️', callback_data: `${CALLBACK_ACTIONS.PAGE_NEXT}:${page}` });
    
    if (navButtons.length > 0) {
      await bot.sendMessage(chatId, `Page ${page + 1}`, { reply_markup: { inline_keyboard: [navButtons] } });
    }
  } catch (err) {
    console.error(`Error in MANAGE for ${chatId}:`, err);
    await bot.sendMessage(chatId, '❌ Could not retrieve medications.');
  }
};

// ========================
// Bot Listeners
// ========================

const initCommands = () => {
  // /start command
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const welcomeText = `👋 Welcome to Re-MIND-eЯ, your personal medication assistant!\n\nChoose an option below:`;
    await sendMainMenu(chatId, welcomeText);
  });

  // Handle text messages (Conversational flow & fallback slash commands)
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text?.trim();
    
    if (!text) return;

    // Handle Fallback text matches/slash commands for main menu actions
    if (text === MAIN_MENU.CANCEL || text === '/cancel') return handleCancel(chatId);
    if (text === MAIN_MENU.SNOOZE || text === '/snooze') return handleSnoozeInfo(chatId);
    if (text === MAIN_MENU.ADD_MED || text === '/addmed') return handleAddMed(chatId);
    if (text === MAIN_MENU.CAREGIVER || text === '/caregiver') return handleCaregiver(chatId);
    if (text === MAIN_MENU.TODAYS_MEDS || text === '/todaysmeds') return handleTodaysMeds(chatId);
    if (text === MAIN_MENU.MY_LOGS || text === '/mylog') return handleMyLogs(chatId);
    if (text === MAIN_MENU.STATS || text === '/stats') return handleStats(chatId);
    if (text === MAIN_MENU.MANAGE || text === '/manage') return handleManage(chatId, 0);

    // If it's a command like /start, ignore here because it's handled by bot.onText
    if (text.startsWith('/')) return;

    // Handle conversational states
    const state = userStates[chatId];
    if (state) {
      try {
        if (state.step === 'waiting_for_cg_id') {
          const cgId = text.trim();
          
          if (!/^CG\d{6}$/.test(cgId)) {
            await bot.sendMessage(chatId, '⚠️ Invalid Caregiver ID format. It should start with CG followed by 6 digits (e.g., CG483920). Please try again or type /cancel to stop.');
            return;
          }

          // Fetch caregiver from DB
          const { data: cgData, error: fetchErr } = await supabase
            .from('caregiver_info')
            .select('*')
            .eq('caregiver_id', cgId)
            .eq('is_active', true);

          if (fetchErr || !cgData || cgData.length === 0) {
            await bot.sendMessage(chatId, '❌ Caregiver ID not found or inactive. Please verify the ID and try again, or type /cancel.');
            return;
          }

          const caregiver = cgData[0];

          // Check if patient already has a linked caregiver
          const { data: patientLinks } = await supabase
            .from('caregiver_info')
            .select('*')
            .eq('patient_telegram_id', chatId.toString())
            .eq('is_active', true);

          if (patientLinks && patientLinks.length > 0) {
            await bot.sendMessage(chatId, '❌ You already have a caregiver linked to your account. For Version 1, a patient can only have one caregiver.');
            delete userStates[chatId];
            return;
          }

          // Check if this ID is already used by another patient
          if (caregiver.patient_telegram_id) {
            await bot.sendMessage(chatId, '❌ This Caregiver ID has already been linked by another patient. Please ask your caregiver to generate a new ID.');
            delete userStates[chatId];
            return;
          }

          // Update caregiver record to link patient
          const { error: linkErr } = await supabase
            .from('caregiver_info')
            .update({ patient_telegram_id: chatId.toString() })
            .eq('caregiver_id', cgId);

          if (linkErr) {
            console.error('[Caregiver] Linking error:', linkErr);
            await bot.sendMessage(chatId, '❌ Failed to link caregiver. Please try again later.');
          } else {
            await bot.sendMessage(chatId, `✅ Successfully linked to caregiver: <b>${escapeHTML(caregiver.caregiver_name)}</b>!`, { parse_mode: 'HTML' });
            
            // Notify the caregiver
            try {
              const patientName = `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim() || 'Your patient';
              await bot.sendMessage(caregiver.caregiver_chat_id, `🔔 <b>Patient Connected!</b>\n\nPatient <b>${escapeHTML(patientName)}</b> has successfully linked to you as their caregiver. You will receive alerts if they miss their medications.`, { parse_mode: 'HTML' });
            } catch (notifyErr) {
              console.error('[Caregiver] Failed to notify caregiver:', notifyErr);
            }
          }

          delete userStates[chatId];
          return;
        }

        if (state.step === STATES.DRUG_NAME) {
          state.drug_name = text;
          state.step = STATES.DOSAGE;
          await bot.sendMessage(chatId, `Got it. What is the dosage for ${state.drug_name}? (e.g., 500mg)`);
          return;
        }

        if (state.step === STATES.DOSAGE) {
          state.dosage = text;
          state.step = 'waiting_for_freq';
          const inlineKeyboard = {
            inline_keyboard: [
              [{ text: '☀️ Once Daily', callback_data: CALLBACK_ACTIONS.FREQ_ONCE }],
              [{ text: '🌤 Twice Daily', callback_data: CALLBACK_ACTIONS.FREQ_TWICE }],
              [{ text: '🌙 Thrice Daily', callback_data: CALLBACK_ACTIONS.FREQ_THRICE }]
            ]
          };
          await bot.sendMessage(chatId, `Great. How often do you take this?`, { reply_markup: inlineKeyboard });
          return;
        }

        if (state.step === STATES.TIME) {
          if (!isValidTime(text)) {
            await bot.sendMessage(chatId, `⚠️ Invalid time format. Please use exactly HH:MM in 24-hour format (e.g., 08:00 or 14:30).`);
            return;
          }
          if (state.times.includes(text)) {
            await bot.sendMessage(chatId, `⚠️ You already added ${text}. Please enter a different time.`);
            return;
          }
          
          state.times.push(text);
          
          if (state.times.length < state.expectedTimes) {
            const ordinals = ['first', 'second', 'third'];
            await bot.sendMessage(chatId, `Got it. What is the ${ordinals[state.times.length]} reminder time?`);
            return;
          }
          
          // Sort chronologically as requested
          state.times.sort((a, b) => a.localeCompare(b));

          state.step = STATES.TABLET_COUNT;
          await bot.sendMessage(chatId, `Perfect. You've set times: ${state.times.join(', ')}.\n\nHow many tablets are currently available? (e.g., 15)`);
          return;
        }

        if (state.step === STATES.TABLET_COUNT) {
          const count = parseInt(text);
          if (isNaN(count) || count < 0) {
            await bot.sendMessage(chatId, `⚠️ Please enter a valid positive number for your tablet count.`);
            return;
          }
          
          state.tablet_count = count;
          state.step = 'waiting_for_priority';
          
          const inlineKeyboard = {
            inline_keyboard: [
              [{ text: '🟢 Normal', callback_data: 'cg_prio_normal' }],
              [{ text: '🟠 Important', callback_data: 'cg_prio_important' }],
              [{ text: '🔴 Critical', callback_data: 'cg_prio_critical' }]
            ]
          };
          
          await bot.sendMessage(chatId, `Select the priority level for ${state.drug_name}:`, { reply_markup: inlineKeyboard });
          return;
        }

        if (state.step === STATES.EDIT_FIELD) {
           let updateData = {};
           if (state.field === 'name') updateData = { drug_name: text };
           if (state.field === 'dosage') updateData = { dosage: text };
           if (state.field === 'stock') {
             const count = parseInt(text);
             if (isNaN(count) || count < 0) return bot.sendMessage(chatId, `⚠️ Invalid stock.`);
             updateData = { tablet_count: count };
           }
           
           const { error } = await supabase.from('medications').update(updateData).eq('id', state.medId);
           if (!error) {
              console.log(`[Manage] User ${chatId} updated med ${state.medId}: ${state.field} -> ${text}`);
              await bot.sendMessage(chatId, `✅ Successfully updated ${state.field}!`);
              delete userStates[chatId];
           } else {
              await bot.sendMessage(chatId, `❌ Update failed.`);
           }
           return;
        }
        
        if (state.step === 'edit_timings_flow') {
           if (!isValidTime(text)) return bot.sendMessage(chatId, `⚠️ Invalid time format. Please use exactly HH:MM in 24-hour format.`);
           if (state.times.includes(text)) return bot.sendMessage(chatId, `⚠️ Duplicate time.`);
           
           state.times.push(text);
           if (state.times.length < state.expectedTimes) {
             const ordinals = ['first', 'second', 'third'];
             return bot.sendMessage(chatId, `Got it. What is the ${ordinals[state.times.length]} time?`);
           }
           
           state.times.sort((a,b) => a.localeCompare(b));
           const nextReminderAt = calculateNextReminder(state.times);
           
           const updatePayload = { reminder_times: state.times, next_reminder_at: nextReminderAt.toISOString() };
           if (state.frequency) updatePayload.frequency = state.frequency;
           
           const { error } = await supabase.from('medications').update(updatePayload).eq('id', state.medId);
           
           if (!error) {
              console.log(`[Manage] User ${chatId} updated timings/freq for med ${state.medId}: ${state.times.join(', ')}`);
              await bot.sendMessage(chatId, `✅ Timings updated successfully! Next reminder: ${nextReminderAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
              delete userStates[chatId];
           } else {
              await bot.sendMessage(chatId, `❌ Update failed.`);
           }
           return;
        }

        if (state.step === STATES.REFILL_COUNT) {
          const addedCount = parseInt(text);
          if (isNaN(addedCount) || addedCount <= 0) {
            await bot.sendMessage(chatId, `⚠️ Please enter a valid positive number of tablets purchased.`);
            return;
          }

          // Fetch current tablet count
          const { data: medData, error: medErr } = await supabase
            .from('medications')
            .select('tablet_count, drug_name')
            .eq('id', state.medId)
            .single();
            
          if (medErr || !medData) {
            await sendMainMenu(chatId, '❌ Error finding this medication.');
            delete userStates[chatId];
            return;
          }

          const newTotal = (medData.tablet_count || 0) + addedCount;
          
          const { error: updateErr } = await supabase
            .from('medications')
            .update({ 
              tablet_count: newTotal,
              low_stock_alert_enabled: true,
              refill_confirmed: true
            })
            .eq('id', state.medId);

          if (updateErr) {
            await sendMainMenu(chatId, '❌ Failed to update tablet count.');
          } else {
            console.log(`[Stock Tracking] ${medData.drug_name} refilled. Added: ${addedCount}. New Total: ${newTotal}`);
            await sendMainMenu(chatId, `✅ Refill successful! You now have ${newTotal} tablets of ${medData.drug_name}. Alerts have been reset.`);
          }
          
          delete userStates[chatId];
          return;
        }
      } catch (err) {
        console.error(`Error in state flow for ${chatId}:`, err);
        await sendMainMenu(chatId, '❌ Something went wrong. Returning to main menu.');
        delete userStates[chatId];
      }
    }
  });

  // Handle Callback Queries (Inline Buttons)
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    try {
      console.log(`[Chat ${chatId}] Callback interaction: ${data}`);

      // MAIN MENU CALLBACKS
      if (data === CALLBACK_ACTIONS.MENU_ADD_MED) {
        await bot.answerCallbackQuery(query.id);
        return handleAddMed(chatId);
      }
      if (data === CALLBACK_ACTIONS.MENU_MY_LOGS) {
        await bot.answerCallbackQuery(query.id);
        return handleMyLogs(chatId);
      }
      if (data === CALLBACK_ACTIONS.MENU_STATS) {
        await bot.answerCallbackQuery(query.id);
        return handleStats(chatId);
      }
      if (data === CALLBACK_ACTIONS.MENU_TODAYS_MEDS) {
        await bot.answerCallbackQuery(query.id);
        return handleTodaysMeds(chatId);
      }
      if (data === CALLBACK_ACTIONS.MENU_SNOOZE) {
        await bot.answerCallbackQuery(query.id);
        return handleSnoozeInfo(chatId);
      }
      if (data === CALLBACK_ACTIONS.MENU_CANCEL) {
        await bot.answerCallbackQuery(query.id);
        return handleCancel(chatId);
      }
      if (data === CALLBACK_ACTIONS.MENU_CAREGIVER) {
        await bot.answerCallbackQuery(query.id);
        return handleCaregiver(chatId);
      }
      if (data === CALLBACK_ACTIONS.CG_PANEL) {
        await bot.answerCallbackQuery(query.id);
        return handleCaregiverPanel(chatId);
      }
      if (data === CALLBACK_ACTIONS.CG_BECOME) {
        await bot.answerCallbackQuery(query.id);
        
        // Check if caregiver already has active ID
        const { data: existingRecords } = await supabase
          .from('caregiver_info')
          .select('*')
          .eq('caregiver_chat_id', chatId.toString())
          .eq('is_active', true);

        if (existingRecords && existingRecords.length > 0) {
          const caregiver = existingRecords[0];
          await bot.sendMessage(chatId, `You are already registered as a caregiver.\n\nYour Caregiver ID:\n<b>${escapeHTML(caregiver.caregiver_id)}</b>`, { parse_mode: 'HTML' });
          return;
        }

        const name = `${query.from.first_name || ''} ${query.from.last_name || ''}`.trim() || 'Caregiver';
        
        let isUnique = false;
        let cgId = '';
        while (!isUnique) {
          cgId = 'CG' + Math.floor(100000 + Math.random() * 900000);
          const { data: existing, error } = await supabase
            .from('caregiver_info')
            .select('id')
            .eq('caregiver_id', cgId);
          if (!error && (!existing || existing.length === 0)) {
            isUnique = true;
          }
        }

        const { error } = await supabase.from('caregiver_info').insert([{
          caregiver_id: cgId,
          caregiver_chat_id: chatId.toString(),
          caregiver_name: name,
          is_active: true
        }]);

        if (error) {
          console.error('[Caregiver] Insert error:', error);
          await bot.sendMessage(chatId, '❌ Failed to register as a caregiver. Please try again.');
        } else {
          const responseMsg = `✅ You have registered as a Caregiver!\n\nYour Caregiver ID is: <b>${escapeHTML(cgId)}</b>\n\nPlease share this ID with your patient manually. They can link you by selecting the <b>👨‍⚕ Add Caregiver</b> option in their bot menu.`;
          await bot.sendMessage(chatId, responseMsg, { parse_mode: 'HTML' });
        }
        return;
      }
      if (data === CALLBACK_ACTIONS.CG_MY_ID) {
        await bot.answerCallbackQuery(query.id);

        const { data: existingRecords } = await supabase
          .from('caregiver_info')
          .select('*')
          .eq('caregiver_chat_id', chatId.toString())
          .eq('is_active', true);

        if (existingRecords && existingRecords.length > 0) {
          const caregiver = existingRecords[0];
          const statusStr = caregiver.patient_telegram_id ? '✅ Patient Connected' : 'No patient linked yet';
          await bot.sendMessage(chatId, `Your Caregiver ID:\n<b>${escapeHTML(caregiver.caregiver_id)}</b>\n\nStatus:\n${escapeHTML(statusStr)}`, { parse_mode: 'HTML' });
        } else {
          await bot.sendMessage(chatId, '❌ You are not registered as a caregiver yet. Please select the **👨‍⚕ Become Caregiver** option to register first.');
        }
        return;
      }
      if (data === CALLBACK_ACTIONS.CG_ADD) {
        await bot.answerCallbackQuery(query.id);
        
        // 1-to-1 checks: Check if patient already has a linked caregiver
        const { data: patientLinks } = await supabase
          .from('caregiver_info')
          .select('*')
          .eq('patient_telegram_id', chatId.toString())
          .eq('is_active', true);

        if (patientLinks && patientLinks.length > 0) {
          await bot.sendMessage(chatId, '❌ You already have a caregiver linked to your account. For Version 1, a patient can only have one caregiver.');
          return;
        }

        userStates[chatId] = { step: 'waiting_for_cg_id' };
        await bot.sendMessage(chatId, '👨‍⚕ Please enter the Caregiver ID shared by your caregiver (e.g., CG483920):');
        return;
      }
      if (data === CALLBACK_ACTIONS.MENU_MANAGE) {
        await bot.answerCallbackQuery(query.id);
        return handleManage(chatId, 0);
      }
      if (data.startsWith(CALLBACK_ACTIONS.PAGE_PREV)) {
        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId });
        await bot.answerCallbackQuery(query.id);
        const [, page] = data.split(':');
        return handleManage(chatId, parseInt(page) - 1);
      }
      if (data.startsWith(CALLBACK_ACTIONS.PAGE_NEXT)) {
        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId });
        await bot.answerCallbackQuery(query.id);
        const [, page] = data.split(':');
        return handleManage(chatId, parseInt(page) + 1);
      }

      if (data === CALLBACK_ACTIONS.ADD_CONFIRM) {
        const state = userStates[chatId];
        if (!state || state.step !== 'confirm_add') return bot.answerCallbackQuery(query.id, {text: 'Flow expired', show_alert: true});
        
        await bot.editMessageText(query.message.text + '\n\n[✅ Confirmed]', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
        await bot.sendMessage(chatId, 'Saving your medication...');
        
        const nextReminderAt = calculateNextReminder(state.times);

        const { error } = await supabase.from('medications').insert([{
          telegram_id: chatId.toString(),
          drug_name: state.drug_name,
          dosage: state.dosage,
          frequency: state.frequency,
          reminder_times: state.times,
          tablet_count: state.tablet_count,
          priority_level: state.priority_level || 'normal',
          next_reminder_at: nextReminderAt.toISOString()
        }]);

        if (error) {
          console.error('Supabase Insert Error:', error);
          await sendMainMenu(chatId, '❌ Sorry, an error occurred while saving your medication.');
        } else {
          await sendMainMenu(chatId, `✅ Successfully added ${state.drug_name}!\n\nYour next reminder is scheduled for: ${nextReminderAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
        }
        delete userStates[chatId];
        return bot.answerCallbackQuery(query.id);
      }

      if (data === CALLBACK_ACTIONS.ADD_EDIT) {
        await bot.editMessageText(query.message.text + '\n\n[✏️ Restarting Setup]', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
        delete userStates[chatId];
        await bot.answerCallbackQuery(query.id);
        return handleAddMed(chatId);
      }

      if (data.startsWith(CALLBACK_ACTIONS.MED_DELETE)) {
        const [, medId] = data.split(':');
        const inlineKeyboard = {
          inline_keyboard: [
            [
              { text: '✅ Yes Delete', callback_data: `${CALLBACK_ACTIONS.MED_DEL_CONFIRM}:${medId}` },
              { text: '❌ Cancel', callback_data: `${CALLBACK_ACTIONS.MED_DEL_CANCEL}:${medId}` }
            ]
          ]
        };
        await bot.editMessageText(query.message.text + '\n\n⚠️ Are you sure you want to delete this medication?', { chat_id: chatId, message_id: messageId, reply_markup: inlineKeyboard });
        return bot.answerCallbackQuery(query.id);
      }

      if (data.startsWith(CALLBACK_ACTIONS.MED_DEL_CANCEL)) {
        await bot.editMessageText(query.message.text.split('\n\n⚠️')[0], { chat_id: chatId, message_id: messageId, reply_markup: {inline_keyboard:[]} });
        return bot.answerCallbackQuery(query.id);
      }

      if (data.startsWith(CALLBACK_ACTIONS.MED_DEL_CONFIRM)) {
        const [, medId] = data.split(':');
        const { error } = await supabase.from('medications').update({ active: false }).eq('id', medId);
        if (error) {
           await bot.answerCallbackQuery(query.id, { text: '❌ Error deleting.', show_alert: true });
        } else {
           console.log(`[Manage] Soft deleted med ID ${medId} for user ${chatId}`);
           await bot.editMessageText(query.message.text.split('\n\n⚠️')[0] + '\n\n[🗑 Deleted]', { chat_id: chatId, message_id: messageId, reply_markup: {inline_keyboard:[]} });
           await bot.answerCallbackQuery(query.id, { text: 'Deleted successfully' });
        }
        return;
      }

      if (data.startsWith(CALLBACK_ACTIONS.MED_EDIT)) {
        const [, medId] = data.split(':');
        const inlineKeyboard = {
          inline_keyboard: [
            [
              { text: '💊 Name', callback_data: `${CALLBACK_ACTIONS.EDIT_SELECT}:name:${medId}` },
              { text: '🧪 Dosage', callback_data: `${CALLBACK_ACTIONS.EDIT_SELECT}:dosage:${medId}` }
            ],
            [
              { text: '⏰ Timings', callback_data: `${CALLBACK_ACTIONS.EDIT_SELECT}:timings:${medId}` },
              { text: '📦 Stock', callback_data: `${CALLBACK_ACTIONS.EDIT_SELECT}:stock:${medId}` }
            ],
            [
              { text: '🔁 Frequency', callback_data: `${CALLBACK_ACTIONS.EDIT_SELECT}:frequency:${medId}` },
              { text: '⚠️ Priority', callback_data: `${CALLBACK_ACTIONS.EDIT_SELECT}:priority:${medId}` }
            ]
          ]
        };
        await bot.editMessageText(query.message.text + '\n\n✏️ What would you like to edit?', { chat_id: chatId, message_id: messageId, reply_markup: inlineKeyboard });
        return bot.answerCallbackQuery(query.id);
      }

      if (data.startsWith(CALLBACK_ACTIONS.EDIT_SELECT)) {
        const [, field, medId] = data.split(':');
        userStates[chatId] = { step: STATES.EDIT_FIELD, field, medId };
        
        try { await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId }); } catch(e){}
        
        let prompt = '';
        if (field === 'name') prompt = 'Enter the new medication name:';
        if (field === 'dosage') prompt = 'Enter the new dosage (e.g., 500mg):';
        if (field === 'stock') prompt = 'Enter the new tablet count:';
        if (field === 'timings') {
           const { data: medData } = await supabase.from('medications').select('frequency').eq('id', medId).single();
           if (medData) {
             let exp = 1;
             if (medData.frequency === FREQUENCIES.twice_daily) exp = 2;
             if (medData.frequency === FREQUENCIES.thrice_daily) exp = 3;
             userStates[chatId] = { step: 'edit_timings_flow', medId, expectedTimes: exp, times: [] };
             prompt = `Editing timings. What is the FIRST time? (HH:MM)`;
           }
        }
        if (field === 'frequency') {
           const inlineKeyboard = {
              inline_keyboard: [
                [{ text: '☀️ Once Daily', callback_data: `${CALLBACK_ACTIONS.EDIT_SELECT}:freq_1:${medId}` }],
                [{ text: '🌤 Twice Daily', callback_data: `${CALLBACK_ACTIONS.EDIT_SELECT}:freq_2:${medId}` }],
                [{ text: '🌙 Thrice Daily', callback_data: `${CALLBACK_ACTIONS.EDIT_SELECT}:freq_3:${medId}` }]
              ]
           };
           await bot.sendMessage(chatId, 'Select new frequency:', { reply_markup: inlineKeyboard });
           return bot.answerCallbackQuery(query.id);
        }

        if (field === 'priority') {
           const inlineKeyboard = {
              inline_keyboard: [
                [{ text: '🟢 Normal', callback_data: `edit_priority:normal:${medId}` }],
                [{ text: '🟠 Important', callback_data: `edit_priority:important:${medId}` }],
                [{ text: '🔴 Critical', callback_data: `edit_priority:critical:${medId}` }]
              ]
           };
           await bot.sendMessage(chatId, 'Select new priority level:', { reply_markup: inlineKeyboard });
           return bot.answerCallbackQuery(query.id);
        }
        
        if (field.startsWith('freq_')) {
           const freqMap = { freq_1: FREQUENCIES.once_daily, freq_2: FREQUENCIES.twice_daily, freq_3: FREQUENCIES.thrice_daily };
           const expMap = { freq_1: 1, freq_2: 2, freq_3: 3 };
           const newFreq = freqMap[field];
           const newExp = expMap[field];
           
           console.log(`[Manage] User ${chatId} changed frequency for Med ${medId} to ${newFreq}`);
           
           userStates[chatId] = { step: 'edit_timings_flow', medId, expectedTimes: newExp, times: [], frequency: newFreq };
           prompt = `Frequency updated to ${newFreq.replace('_', ' ')}.\nNow, what is the FIRST reminder time? (HH:MM)`;
        }

        if (prompt) {
          await bot.sendMessage(chatId, prompt);
        }
        return bot.answerCallbackQuery(query.id);
      }

      // FREQUENCY SELECTION FOR ADDMED
      if ([CALLBACK_ACTIONS.FREQ_ONCE, CALLBACK_ACTIONS.FREQ_TWICE, CALLBACK_ACTIONS.FREQ_THRICE].includes(data)) {
        await bot.answerCallbackQuery(query.id); // Fixed double message bug!
        
        const state = userStates[chatId];
        if (!state) {
          await bot.editMessageText('❌ Flow expired.', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
          return;
        }

        let frequency = '';
        let expectedTimes = 1;
        if (data === CALLBACK_ACTIONS.FREQ_ONCE) { frequency = FREQUENCIES.once_daily; expectedTimes = 1; }
        if (data === CALLBACK_ACTIONS.FREQ_TWICE) { frequency = FREQUENCIES.twice_daily; expectedTimes = 2; }
        if (data === CALLBACK_ACTIONS.FREQ_THRICE) { frequency = FREQUENCIES.thrice_daily; expectedTimes = 3; }

        state.frequency = frequency;
        state.expectedTimes = expectedTimes;
        state.times = [];
        state.step = STATES.TIME;

        await bot.editMessageText(`Frequency chosen: ${frequency.replace('_', ' ')}`, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
        
        await bot.sendMessage(chatId, 'What is the first reminder time? Please use exactly HH:MM in 24-hour format (e.g., 08:00 or 21:30).');
        return;
      }
      // PRIORITY SELECTION FOR ADDMED
      if (['cg_prio_normal', 'cg_prio_important', 'cg_prio_critical'].includes(data)) {
        await bot.answerCallbackQuery(query.id);
        const state = userStates[chatId];
        if (!state || state.step !== 'waiting_for_priority') {
          await bot.editMessageText('❌ Flow expired.', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
          return;
        }

        const priority = data.split('_')[2];
        state.priority_level = priority;
        state.step = 'confirm_add';

        const priorityEmoji = priority === 'normal' ? '🟢' : priority === 'important' ? '🟠' : '🔴';
        const summary = `Please confirm your new medication:\n\n💊 ${state.drug_name}\n🧪 ${state.dosage}\n🔁 ${state.frequency.replace('_', ' ')}\n⏰ ${state.times.join(', ')}\n📦 ${state.tablet_count} tablets\n⚠️ Priority: ${priorityEmoji} ${priority.toUpperCase()}`;

        const confirmKeyboard = {
          inline_keyboard: [
            [
              { text: '✅ Confirm', callback_data: CALLBACK_ACTIONS.ADD_CONFIRM },
              { text: '✏️ Edit', callback_data: CALLBACK_ACTIONS.ADD_EDIT }
            ]
          ]
        };
        await bot.editMessageText(summary, { chat_id: chatId, message_id: messageId, reply_markup: confirmKeyboard });
        return;
      }
      if (data.startsWith('edit_priority:')) {
         await bot.answerCallbackQuery(query.id);
         const [, priority, medId] = data.split(':');
         
         const { error } = await supabase.from('medications').update({ priority_level: priority }).eq('id', medId);
         if (!error) {
            console.log(`[Manage] User ${chatId} updated priority for med ${medId} to ${priority}`);
            await bot.sendMessage(chatId, `✅ Successfully updated priority to ${priority.toUpperCase()}!`);
         } else {
            await bot.sendMessage(chatId, `❌ Update failed.`);
         }
         return;
      }

      // REFILL ACTIONS
      if (data.startsWith(CALLBACK_ACTIONS.REFILL_BOUGHT)) {
        const [, medId] = data.split(':');
        userStates[chatId] = { step: STATES.REFILL_COUNT, medId: medId };
        await bot.editMessageText(query.message.text + '\n\n[✅ Bought selected]', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
        await bot.sendMessage(chatId, 'How many tablets did you purchase?');
        await bot.answerCallbackQuery(query.id);
        return;
      }

      if (data.startsWith(CALLBACK_ACTIONS.REFILL_STOP)) {
        const [, medId] = data.split(':');
        
        const { error } = await supabase.from('medications').update({ low_stock_alert_enabled: false }).eq('id', medId);
        
        if (error) {
          await bot.answerCallbackQuery(query.id, { text: '❌ Failed to update.', show_alert: true });
        } else {
          await bot.editMessageText(query.message.text + '\n\n[❌ Alerts Stopped]', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
          await bot.answerCallbackQuery(query.id, { text: 'Refill reminders stopped.' });
        }
        return;
      }

      // REMINDER RESPONSES
      const [action, medId, scheduledTime] = data.split(':');
      
      const isPatientAction = [CALLBACK_ACTIONS.TAKEN, CALLBACK_ACTIONS.SKIP, CALLBACK_ACTIONS.SNOOZE].includes(action);
      const isCaregiverAction = [CALLBACK_ACTIONS.CG_TAKEN, CALLBACK_ACTIONS.CG_SKIP].includes(action);

      if (!isPatientAction && !isCaregiverAction) return;

      let responseType = '';
      if (action === CALLBACK_ACTIONS.TAKEN || action === CALLBACK_ACTIONS.CG_TAKEN) {
        responseType = 'TAKEN';
      } else if (action === CALLBACK_ACTIONS.SKIP || action === CALLBACK_ACTIONS.CG_SKIP) {
        responseType = 'SKIP';
      }

      const formattedScheduledTime = new Date(parseInt(scheduledTime)).toISOString();

      // Fetch the active event from reminder_events
      const { data: activeEvents, error: getErr } = await supabase
        .from('reminder_events')
        .select('*')
        .eq('medication_id', medId)
        .eq('scheduled_for', formattedScheduledTime)
        .in('reminder_status', ['PENDING_PATIENT', 'RETRYING_PATIENT', 'ESCALATED_TO_CG', 'SNOOZED']);

      if (getErr || !activeEvents || activeEvents.length === 0) {
        await bot.answerCallbackQuery(query.id, { text: 'This dose has already been resolved.', show_alert: true });
        try {
          await bot.editMessageText(`${query.message.text}\n\n[Status: Already resolved]`, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [] }
          });
        } catch (e) {}
        return;
      }

      const event = activeEvents[0];

      if (action === CALLBACK_ACTIONS.SNOOZE) {
        const currentSnoozes = event.snooze_count;
        if (currentSnoozes >= MAX_SNOOZES) {
          await bot.answerCallbackQuery(query.id, { text: 'Snooze limit reached for this reminder.', show_alert: true });
          await bot.editMessageText(`${query.message.text}\n\n[Status: ❌ Snooze limit reached]`, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
          return;
        }

        // Try to update/lock the record atomically in reminder_events
        const now = new Date();
        const snoozeTime = new Date(Date.now() + SNOOZE_MINUTES * 60 * 1000);

        const { data: updateData, error: snoozeErr } = await supabase
          .from('reminder_events')
          .update({
            reminder_status: 'SNOOZED',
            retry_reminder_at: snoozeTime.toISOString(),
            retry_count: 0,
            snooze_count: currentSnoozes + 1
          })
          .eq('id', event.id)
          .eq('reminder_status', event.reminder_status)
          .select();

        if (snoozeErr || !updateData || updateData.length === 0) {
          await bot.answerCallbackQuery(query.id, { text: 'This dose has already been resolved.', show_alert: true });
          try {
            await bot.editMessageText(`${query.message.text}\n\n[Status: Already resolved]`, {
              chat_id: chatId,
              message_id: messageId,
              reply_markup: { inline_keyboard: [] }
            });
          } catch (e) {}
          return;
        }

        console.log(`[Workflow State Change] Callback SNOOZED event ID ${event.id} (new snooze_count: ${currentSnoozes + 1})`);

        // Maintain in-memory snooze tracker as well
        activeSnoozes[medId] = currentSnoozes + 1;

        await bot.editMessageText(`${query.message.text}\n\n[Status: ⏰ Snoozed for ${SNOOZE_MINUTES}m]`, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
        await bot.answerCallbackQuery(query.id, { text: `Snoozed for ${SNOOZE_MINUTES}m` });
        return;
      }

      // Handle TAKEN / SKIP / CG_TAKEN / CG_SKIP
      let resolvedStatus = 'TAKEN';
      let resolvedBy = 'PATIENT';
      if (action === CALLBACK_ACTIONS.TAKEN) {
        resolvedStatus = 'TAKEN';
        resolvedBy = 'PATIENT';
      } else if (action === CALLBACK_ACTIONS.SKIP) {
        resolvedStatus = 'SKIPPED';
        resolvedBy = 'PATIENT';
      } else if (action === CALLBACK_ACTIONS.CG_TAKEN) {
        resolvedStatus = 'RESOLVED_BY_CG';
        resolvedBy = 'CAREGIVER';
      } else if (action === CALLBACK_ACTIONS.CG_SKIP) {
        resolvedStatus = 'RESOLVED_BY_CG';
        resolvedBy = 'CAREGIVER';
      }

      // Try to update/lock the event atomically
      const { data: updateData, error: updateErr } = await supabase
        .from('reminder_events')
        .update({
          reminder_status: resolvedStatus,
          resolved_at: new Date().toISOString(),
          resolved_by: resolvedBy,
          retry_reminder_at: null,
          retry_count: 0
        })
        .eq('id', event.id)
        .eq('reminder_status', event.reminder_status)
        .select();

      if (updateErr || !updateData || updateData.length === 0) {
        await bot.answerCallbackQuery(query.id, { text: 'This dose has already been resolved.', show_alert: true });
        try {
          await bot.editMessageText(`${query.message.text}\n\n[Status: Already resolved]`, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [] }
          });
        } catch (e) {}
        return;
      }

      console.log(`[Workflow State Change] Callback resolved event ID ${event.id} status: ${resolvedStatus} by ${resolvedBy}`);

      // Fetch the medication configuration record to retrieve patient details and stock count
      const { data: medData, error: getMedErr } = await supabase
        .from('medications')
        .select('*')
        .eq('id', medId)
        .single();

      if (getMedErr || !medData) {
        throw new Error('Medication record not found for logging.');
      }

      // Clean up in-memory snoozes if action is taken/skip
      delete activeSnoozes[medId];

      // Update old scheduling columns on medications table for backward compatibility
      await supabase
        .from('medications')
        .update({
          retry_count: 0,
          retry_reminder_at: null,
          last_reminder_scheduled_at: null
        })
        .eq('id', medId);

      // Check if log already exists to prevent duplicate logging (e.g. from patient/caregiver collision)
      const { data: existingLogs, error: checkLogErr } = await supabase
        .from('reminder_logs')
        .select('id')
        .eq('medication_id', medId)
        .eq('scheduled_time', formattedScheduledTime);

      if (!checkLogErr && existingLogs && existingLogs.length > 0) {
        await bot.answerCallbackQuery(query.id, { text: 'This dose has already been logged.', show_alert: true });
        try {
          await bot.editMessageText(`${query.message.text}\n\n[Status: Already logged]`, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [] }
          });
        } catch (e) {}
        return;
      }

      const delayMinutes = Math.max(0, Math.round((Date.now() - new Date(parseInt(scheduledTime)).getTime()) / 60000));

      if (responseType === 'TAKEN') {
        // Fetch current count and decrement
        if (medData.tablet_count > 0) {
          const newCount = medData.tablet_count - 1;
          await supabase.from('medications').update({ tablet_count: newCount }).eq('id', medId);
          console.log(`[Stock Tracking] ${medData.drug_name} taken. New tablet count: ${newCount}`);
        }
      }

      // Save log for TAKEN or SKIP
      const { error } = await supabase.from('reminder_logs').insert([{
        telegram_id: medData.telegram_id,
        medication_id: medId,
        scheduled_time: formattedScheduledTime,
        response: responseType,
        delay_minutes: responseType === 'TAKEN' ? delayMinutes : null
      }]);

      if (error) throw error;

      let updatedText = '';
      const delayStr = responseType === 'TAKEN' && delayMinutes > 5 ? ` (${delayMinutes}m late)` : '';
      if (isCaregiverAction) {
        updatedText = `${query.message.text}\n\n[Status: Marked as ${responseType === 'TAKEN' ? 'TAKEN' : 'SKIP'}${delayStr} by Caregiver]`;
      } else {
        updatedText = `${query.message.text}\n\n[Status: ${responseType === 'TAKEN' ? `✅ Logged as TAKEN${delayStr}` : '⏭ Logged as SKIP'}]`;
      }
      
      await bot.editMessageText(updatedText, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] }
      });

      await bot.answerCallbackQuery(query.id, { text: 'Logged successfully ✅' });

      // If resolved by caregiver, send a notification to the patient
      if (isCaregiverAction) {
        try {
          const caregiverName = query.from.first_name || 'Your caregiver';
          const notificationMsg = `🔔 <b>Caregiver Intervention</b>\n\nYour caregiver <b>${escapeHTML(caregiverName)}</b> has marked your medication <b>${escapeHTML(medData.drug_name)}</b> as <b>${escapeHTML(responseType)}</b>.`;
          await bot.sendMessage(medData.telegram_id, notificationMsg, { parse_mode: 'HTML' });
        } catch (notifyErr) {
          console.error('[Caregiver Action] Failed to notify patient:', notifyErr);
        }
      }

    } catch (err) {
      console.error(`Error handling callback query for ${chatId}:`, err);
      try { await bot.answerCallbackQuery(query.id, { text: '❌ Action failed or already processed.', show_alert: true }); } catch (e) {}
    }
  });
};

module.exports = {
  initCommands,
  sendMainMenu
};
