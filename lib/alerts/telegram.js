// lib/alerts/telegram.js
// ============================================================================
// Backend's own copy of the Telegram Bot API call already used by the
// frontend's InAppChat (frontend: utils/telegram.ts / pages/api/telegram/*).
// Deliberately NOT shared code across the two Vercel projects - it's a plain
// HTTPS call to api.telegram.org, so there's nothing to share; the backend
// just needs its own TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID env vars (same
// bot/chat as the frontend, so business staff see it in the chat they
// already watch for customer messages).
// ============================================================================

const TELEGRAM_API_BASE = 'https://api.telegram.org';

async function sendTelegramAlert(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error('Telegram alert unavailable: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set on the backend');
  }

  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Telegram API error: ${data.description || response.status}`);
  }
  return data;
}

module.exports = { sendTelegramAlert };
