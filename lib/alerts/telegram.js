// lib/alerts/telegram.js
// ============================================================================
// Backend's own copy of the Telegram Bot API call already used by the
// frontend's InAppChat (frontend: utils/telegram.ts / pages/api/telegram/*).
// Deliberately NOT shared code across the two Vercel projects - it's a plain
// HTTPS call to api.telegram.org, so there's nothing to share; the backend
// just needs its own TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID env vars (same
// bot/chat as the frontend, so business staff see it in the chat they
// already watch for customer messages).
//
// sendTelegramDocument() uploads a file (the order PDFs) as multipart form
// data. Bot uploads are limited to 50 MB per file; our PDFs are ~70-500 KB.
// TELEGRAM_API_BASE exists only so local tests can point at a mock server.
// ============================================================================

const TELEGRAM_API_BASE = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';
const TELEGRAM_TIMEOUT_MS = 20000;
const TELEGRAM_TEXT_LIMIT = 4096;

function telegramConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error('Telegram alert unavailable: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set on the backend');
  }
  return { token, chatId };
}

function isTelegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

async function callTelegram(method, init) {
  const { token } = telegramConfig();
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
    ...init,
    signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Telegram API error: HTTP ${response.status} (non-JSON response)`);
  }
  if (!data.ok) {
    throw new Error(`Telegram API error: ${data.description || response.status}`);
  }
  return data;
}

async function sendTelegramAlert(text) {
  const { chatId } = telegramConfig();
  const safeText = text.length > TELEGRAM_TEXT_LIMIT
    ? `${text.slice(0, TELEGRAM_TEXT_LIMIT - 20)}\n...(truncated)`
    : text;
  return callTelegram('sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: safeText }),
  });
}

/**
 * Upload one PDF to the chat.
 * @param {{ name: string, contentBytes: string }} file  base64 content, as send-email.js holds it
 * @param {string} [caption]  short text shown under the file (Telegram max 1024 chars)
 */
async function sendTelegramDocument(file, caption) {
  const { chatId } = telegramConfig();
  const bytes = Buffer.from(file.contentBytes, 'base64');
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) form.append('caption', caption.slice(0, 1024));
  form.append('document', new Blob([bytes], { type: 'application/pdf' }), file.name || 'attachment.pdf');
  return callTelegram('sendDocument', { method: 'POST', body: form });
}

module.exports = { sendTelegramAlert, sendTelegramDocument, isTelegramConfigured };
