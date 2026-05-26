const { bot } = require('./bot');
const { supabase } = require('./db');
const { STATES, FREQUENCIES, CALLBACK_ACTIONS, MAIN_MENU, MAX_SNOOZES, SNOOZE_MINUTES } = require('./constants');
const { isValidTime, calculateNextReminder, activeSnoozes } = require('./utils');

const userStates = {};

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
  userStates[chatId] = { step: STATES.ADD_CAREGIVER_INFO };
  await bot.sendMessage(chatId, '👨‍⚕ Let\'s set up your caregiver.\n\nPlease enter your caregiver\'s phone number or Telegram username:');
};

const handleTodaysMeds = async (chatId) => {
  try {
    const { data: meds, error: medsError } = await supabase.from('medications').select('*').eq('telegram_id', chatId.toString()).eq('active', true);
    if (medsError) throw medsError;

    if (!meds || meds.length === 0) {
      await bot.sendMessage(chatId, "You have no active medications.");
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
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
      let timeString = nextDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
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
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data: logs, error: logsError } = await supabase
      .from('reminder_logs')
      .select('response, scheduled_time, medication_id')
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
      const status = log.response === 'TAKEN' ? '✅ TAKEN' : '⏭ SKIP';
      logText += `${drug} → ${status}\n`;
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

    let statsText = "📊 Weekly Adherence Stats:\n\n";
    for (const [drug, data] of Object.entries(stats)) {
      const percentage = Math.round((data.taken / data.total) * 100);
      statsText += `${drug} → ${data.taken}/${data.total} doses (${percentage}%)\n`;
    }

    await bot.sendMessage(chatId, statsText);
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
      const timesStr = med.reminder_times ? med.reminder_times.join(', ') : 'N/A';
      const text = `💊 **${med.drug_name}** ${med.dosage || ''}\n🔁 ${med.frequency.replace('_', ' ')}\n⏰ ${timesStr}\n📦 Stock: ${med.tablet_count}`;
      const inlineKeyboard = {
        inline_keyboard: [
          [
            { text: '✏️ Edit', callback_data: `${CALLBACK_ACTIONS.MED_EDIT}:${med.id}` },
            { text: '🗑 Delete', callback_data: `${CALLBACK_ACTIONS.MED_DELETE}:${med.id}` }
          ]
        ]
      };
      await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: inlineKeyboard });
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
        if (state.step === STATES.ADD_CAREGIVER_INFO) {
          const { error } = await supabase.from('caregiver_info').insert([{
            telegram_id: chatId.toString(),
            caregiver_contact: text
          }]);
          if (error) throw error;
          
          await sendMainMenu(chatId, `✅ Caregiver info saved successfully!`);
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
          state.step = 'confirm_add';
          
          const summary = `Please confirm your new medication:\n\n💊 ${state.drug_name}\n🧪 ${state.dosage}\n🔁 ${state.frequency.replace('_', ' ')}\n⏰ ${state.times.join(', ')}\n📦 ${count} tablets`;
          const confirmKeyboard = {
            inline_keyboard: [
              [
                { text: '✅ Confirm', callback_data: CALLBACK_ACTIONS.ADD_CONFIRM },
                { text: '✏️ Edit', callback_data: CALLBACK_ACTIONS.ADD_EDIT }
              ]
            ]
          };
          await bot.sendMessage(chatId, summary, { reply_markup: confirmKeyboard });
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
              { text: '🔁 Frequency', callback_data: `${CALLBACK_ACTIONS.EDIT_SELECT}:frequency:${medId}` }
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
      
      let responseType = '';
      if (action === CALLBACK_ACTIONS.TAKEN) responseType = 'TAKEN';
      else if (action === CALLBACK_ACTIONS.SKIP) responseType = 'SKIP';
      else if (action === CALLBACK_ACTIONS.SNOOZE) {
        
        const currentSnoozes = activeSnoozes[medId] || 0;
        if (currentSnoozes >= MAX_SNOOZES) {
          await bot.answerCallbackQuery(query.id, { text: 'Snooze limit reached for this reminder.', show_alert: true });
          await bot.editMessageText(`${query.message.text}\n\n[Status: ❌ Snooze limit reached]`, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
          return;
        }

        activeSnoozes[medId] = currentSnoozes + 1;

        // Add snooze minutes to now
        const now = new Date();
        now.setMinutes(now.getMinutes() + SNOOZE_MINUTES);
        
        const { error: snoozeErr } = await supabase.from('medications').update({
          next_reminder_at: now.toISOString(),
          last_sent_at: new Date().toISOString(), // refresh last sent to avoid immediate double-triggers
          retry_count: 0,
          last_reminder_scheduled_at: null
        }).eq('id', medId);
        
        if (snoozeErr) throw snoozeErr;

        await bot.editMessageText(`${query.message.text}\n\n[Status: ⏰ Snoozed for ${SNOOZE_MINUTES}m]`, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
        await bot.answerCallbackQuery(query.id, { text: `Snoozed for ${SNOOZE_MINUTES}m` });
        return;
      }
      else return;

      // Clean up snoozes if action is taken/skip
      delete activeSnoozes[medId];

      // Reset retry state on response (TAKEN/SKIP)
      await supabase.from('medications').update({
        retry_count: 0,
        last_reminder_scheduled_at: null
      }).eq('id', medId);

      if (responseType === 'TAKEN') {
        // Fetch current count and decrement
        const { data: medData, error: medErr } = await supabase.from('medications').select('tablet_count, drug_name').eq('id', medId).single();
        if (!medErr && medData && medData.tablet_count > 0) {
          const newCount = medData.tablet_count - 1;
          await supabase.from('medications').update({ tablet_count: newCount }).eq('id', medId);
          console.log(`[Stock Tracking] ${medData.drug_name} taken. New tablet count: ${newCount}`);
        }
      }

      // Save log for TAKEN or SKIP
      const { error } = await supabase.from('reminder_logs').insert([{
        telegram_id: chatId.toString(),
        medication_id: medId,
        scheduled_time: new Date(parseInt(scheduledTime)).toISOString(),
        response: responseType
      }]);

      if (error) throw error;

      const updatedText = `${query.message.text}\n\n[Status: ${responseType === 'TAKEN' ? '✅ Logged as TAKEN' : '⏭ Logged as SKIP'}]`;
      
      await bot.editMessageText(updatedText, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] }
      });

      await bot.answerCallbackQuery(query.id, { text: 'Logged successfully ✅' });

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
