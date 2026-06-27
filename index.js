require('dotenv').config();
const express = require('express');
const { bot } = require('./src/bot');
const { initCommands } = require('./src/commands');
const { initScheduler } = require('./src/scheduler');
const { initVoiceScheduler } = require('./src/voice-scheduler');

// Health-check express server (UptimeRobot, Render)
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.json({
    status: "running",
    bot: "Re-MIND-eЯ"
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
