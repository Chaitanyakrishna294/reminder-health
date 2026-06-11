require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_BOT_TOKEN;

let bot;

function isTelegramChatId(id) {
  if (!id) return false;
  const idStr = id.toString();
  if (idStr.startsWith('WEB-')) return false;
  return /^\d+$/.test(idStr);
}

if (token && token !== 'your_telegram_bot_token') {
  bot = new TelegramBot(token, { polling: true });

  // Wrap sendMessage to safely bypass synthetic/non-Telegram IDs
  const originalSendMessage = bot.sendMessage.bind(bot);
  bot.sendMessage = async function(chatId, ...args) {
    if (!isTelegramChatId(chatId)) {
      console.log(`[Telegram Mock] Skipping sendMessage for synthetic/non-Telegram ID: ${chatId}`);
      return null;
    }
    return originalSendMessage(chatId, ...args);
  };

  // Wrap getChat to safely bypass synthetic/non-Telegram IDs
  const originalGetChat = bot.getChat.bind(bot);
  bot.getChat = async function(chatId, ...args) {
    if (!isTelegramChatId(chatId)) {
      console.log(`[Telegram Mock] Skipping getChat for synthetic/non-Telegram ID: ${chatId}`);
      throw new Error(`Chat not found for synthetic ID: ${chatId}`);
    }
    return originalGetChat(chatId, ...args);
  };

  console.log('🤖 Telegram bot initialized with Long Polling.');
} else {
  console.warn('⚠️ TELEGRAM_BOT_TOKEN missing. Bot is NOT running.');
  // Mock bot for initialization without env vars
  bot = {
    onText: () => {},
    on: () => {},
    sendMessage: async (chatId) => {
      console.log(`[Telegram Mock] Mock sendMessage for ID: ${chatId}`);
      return null;
    },
    getChat: async (chatId) => {
      console.log(`[Telegram Mock] Mock getChat for ID: ${chatId}`);
      throw new Error(`Bot is not running (Mock getChat for ${chatId})`);
    },
    answerCallbackQuery: async () => {},
    editMessageText: async () => {}
  };
}

module.exports = {
  bot
};
