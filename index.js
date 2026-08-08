require('dotenv').config();
const express = require('express');
const { bot } = require('./src/bot');
const { initCommands } = require('./src/commands');
const { initScheduler } = require('./src/scheduler');
const { initVoiceScheduler } = require('./src/voice-scheduler');

// Health-check express server (UptimeRobot, Render)
const app = express();
const PORT = process.env.PORT || 3000;

// STARTED_AT is fixed at process boot, so two probes with different values prove a
// restart happened even when the commit did not change.
const STARTED_AT = new Date().toISOString();

app.get('/', (req, res) => {
  res.json({
    status: "running",
    bot: "Re-MIND-eЯ",
    // Render injects RENDER_GIT_COMMIT into every deploy. Without it this endpoint
    // returned the same hardcoded body forever, so "is the worker running the commit
    // I just pushed?" was unanswerable from outside — the dashboard was the only
    // source of truth. Null when running locally or on a host that doesn't set it.
    commit: process.env.RENDER_GIT_COMMIT || null,
    started_at: STARTED_AT
  });
});

app.listen(PORT, () => {
  console.log(`🌐 Health check server running on port ${PORT}`);
});

// Initialize bot if token is present
if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN !== 'your_telegram_bot_token') {
  console.log('🚀 Starting Re-MIND-eЯ Bot...');
  initCommands();
  initScheduler();
  // Additive, isolated voice-call scheduler. No-ops unless VOICE_CALLS_ENABLED=true.
  initVoiceScheduler();

  // Graceful shutdown handling
  process.once('SIGINT', () => bot.stopPolling());
  process.once('SIGTERM', () => bot.stopPolling());
} else {
  console.warn('⚠️ Please configure .env before starting the full bot features.');
}
