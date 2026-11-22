// lib/email/postmark.js
// ============================================================================
// Backup email sender for CUSTOMER emails, used only when Microsoft Graph
// fails. Postmark runs on its own hardware + AWS, not Microsoft (checked
// 2026-11-14). Free Developer plan: 100 emails/month, stops at the limit.
//
// Env (backend Vercel project):
//   POSTMARK_SERVER_TOKEN   Server API token from the Postmark server
//   POSTMARK_FROM_EMAIL     verified sender, e.g. orders@orders.fluidpowergroup.com.au
//   POSTMARK_FROM_NAME      optional display name (default "FluidPower Group")
//   POSTMARK_MESSAGE_STREAM optional (default "outbound", the transactional stream)
// Replies go to the business inbox (Reply-To) so customers can still answer.
// POSTMARK_API_BASE exists only so local tests can point at a mock server.
// ============================================================================

const POSTMARK_API_BASE = process.env.POSTMARK_API_BASE || 'https://api.postmarkapp.com';
const POSTMARK_TIMEOUT_MS = 20000;

function isPostmarkConfigured() {
  return Boolean(process.env.POSTMARK_SERVER_TOKEN && process.env.POSTMARK_FROM_EMAIL);
}

/**
 * Send one email through Postmark.
 * @param {object} opts
 * @param {string} opts.to
 * @param {string} opts.subject
 * @param {string} opts.html
 * @param {string} [opts.replyTo]
 * @param {Array<{name: string, contentBytes: string}>} [opts.attachments] base64 PDFs
 * @param {string} [opts.tag]  Postmark tag for filtering in its activity log
 */
async function sendPostmarkEmail({ to, subject, html, replyTo, attachments = [], tag }) {
  if (!isPostmarkConfigured()) {
    throw new Error('Postmark backup unavailable: POSTMARK_SERVER_TOKEN / POSTMARK_FROM_EMAIL not set');
  }
  const fromName = process.env.POSTMARK_FROM_NAME || 'FluidPower Group';
  const body = {
    From: `${fromName} <${process.env.POSTMARK_FROM_EMAIL}>`,
    To: to,
    Subject: subject,
    HtmlBody: html,
    MessageStream: process.env.POSTMARK_MESSAGE_STREAM || 'outbound',
  };
  if (replyTo) body.ReplyTo = replyTo;
  if (tag) body.Tag = tag;
  if (attachments.length > 0) {
    body.Attachments = attachments.map((a, i) => ({
      Name: a.name || `Attachment-${i + 1}.pdf`,
      Content: a.contentBytes,
      ContentType: 'application/pdf',
    }));
  }

  const response = await fetch(`${POSTMARK_API_BASE}/email`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': process.env.POSTMARK_SERVER_TOKEN,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(POSTMARK_TIMEOUT_MS),
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    // fall through with empty data
  }
  // Postmark answers 200 + ErrorCode 0 on success; anything else is a failure
  // (e.g. 406 inactive recipient, 422 invalid request, 401 bad token).
  if (!response.ok || (data.ErrorCode && data.ErrorCode !== 0)) {
    throw new Error(`Postmark send failed: HTTP ${response.status} code ${data.ErrorCode ?? '?'} - ${data.Message || 'no message'}`);
  }
  return { messageId: data.MessageID };
}

module.exports = { isPostmarkConfigured, sendPostmarkEmail };
