// Failover Telegram sender for /api/cron/tick.
//
// The Telegram Bot API is plain HTTPS — when the Render worker is down only
// *receiving* (long-polling, callback handling) dies with it; sendMessage works
// from anywhere holding the token. Buttons carry the exact callback_data strings
// the bot's router parses (src/commands.js), so taps made once the bot resumes
// behave normally. Taps made while the bot is still down go unanswered — the
// reminder text still arriving beats silence, and the dashboard remains usable.
//
// Fire-and-forget: never throws into the tick. No-op without TELEGRAM_BOT_TOKEN
// or for synthetic WEB-* chat ids (web-only accounts).

// Mirrors MAX_SNOOZES in src/constants.js. If the cap changes there, the DB-side
// check in the bot still enforces it — this only affects whether the button shows.
const MAX_SNOOZES = 3;

export const escapeTelegramHTML = (val: unknown): string =>
  String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

export function doseKeyboard(medicationId: number | string, scheduledTimeMs: number, snoozeCount = 0) {
  const buttons = [
    { text: '✅ TAKEN', callback_data: `taken:${medicationId}:${scheduledTimeMs}` },
    { text: '⏭ SKIP', callback_data: `skip:${medicationId}:${scheduledTimeMs}` },
  ];
  if (snoozeCount < MAX_SNOOZES) {
    buttons.splice(1, 0, { text: '⏰ Snooze 10m', callback_data: `snooze:${medicationId}:${scheduledTimeMs}` });
  }
  return { inline_keyboard: [buttons] };
}

export function caregiverAlertKeyboard(medicationId: number | string, scheduledTimeMs: number) {
  return {
    inline_keyboard: [[
      { text: '🤝 Acknowledge Alert', callback_data: `CG_ACKNOWLEDGE:${medicationId}:${scheduledTimeMs}` },
      { text: '✅ Confirm Taken', callback_data: `CG_TAKEN:${medicationId}:${scheduledTimeMs}` },
    ]],
  };
}

export async function sendTelegramMessage(
  chatId: string | number,
  html: string,
  replyMarkup?: object,
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId || String(chatId).startsWith('WEB-')) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: html,
        parse_mode: 'HTML',
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
    if (!res.ok) console.error('[Telegram] sendMessage failed:', res.status, await res.text());
    return res.ok;
  } catch (err) {
    console.error('[Telegram] sendMessage error:', err);
    return false;
  }
}
