require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_BOT_TOKEN;

let bot;

if (token && token !== 'your_telegram_bot_token') {
  bot = new TelegramBot(token, { polling: true });
  console.log('🤖 Telegram bot initialized with Long Polling.');
} else {
  console.warn('⚠️ TELEGRAM_BOT_TOKEN missing. Bot is NOT running.');
  // Mock bot for initialization without env vars
  bot = {
    onText: () => {},
    on: () => {},
    sendMessage: async () => {},
    answerCallbackQuery: async () => {},
    editMessageText: async () => {}
  };
}

module.exports = {
  bot
};
