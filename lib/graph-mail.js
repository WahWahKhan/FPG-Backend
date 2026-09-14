// lib/graph-mail.js
// ============================================================================
// Minimal Microsoft Graph helper for NEW endpoints (Tube360 quote requests +
// SharePoint uploads). Mirrors the self-contained helpers in pages/api/cart/save.js.
// The token is for the whole Azure app, so once the owner grants Sites.Selected
// on the Tube360 site the same token also works for lib/tube360/sharepoint.js.
// save.js / send-email.js are intentionally NOT refactored onto this module -
// they work today and are on the checkout money path.
// ============================================================================

const TESTING_MODE = process.env.TESTING_MODE === 'true';

function businessEmail() {
  return TESTING_MODE
    ? (process.env.BUSINESS_EMAIL_TEST || 'info@agcomponents.com.au')
    : process.env.BUSINESS_EMAIL;
}

function senderEmail() {
  return TESTING_MODE
    ? (process.env.SENDER_EMAIL_TEST || process.env.SENDER_EMAIL)
    : process.env.SENDER_EMAIL;
}

function isMailConfigured() {
  return Boolean(
    process.env.AZURE_TENANT_ID &&
      process.env.AZURE_CLIENT_ID &&
      process.env.AZURE_CLIENT_SECRET &&
      senderEmail() &&
      businessEmail()
  );
}

// Client-credentials tokens last ~60 min; reuse one per server instance until
// 5 minutes before expiry (Tube360 uploads make several Graph calls per file).
let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function getGraphAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;
  const params = new URLSearchParams();
  params.append('client_id', process.env.AZURE_CLIENT_ID);
  params.append('client_secret', process.env.AZURE_CLIENT_SECRET);
  params.append('scope', 'https://graph.microsoft.com/.default');
  params.append('grant_type', 'client_credentials');
  const resp = await fetch(
    `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params }
  );
  if (!resp.ok) throw new Error(`Graph token failed: ${resp.status} - ${await resp.text()}`);
  const data = await resp.json();
  cachedToken = data.access_token;
  cachedTokenExpiresAt = Date.now() + Math.max(0, (Number(data.expires_in) || 3600) - 300) * 1000;
  return cachedToken;
}

/**
 * Send one HTML email. `replyTo` (optional) lets the business simply hit
 * "Reply" to answer the customer.
 */
async function sendGraphMail(accessToken, { to, subject, html, replyTo }) {
  const message = {
    subject: TESTING_MODE ? `[TEST] ${subject}` : subject,
    body: { contentType: 'HTML', content: html },
    toRecipients: [{ emailAddress: { address: to } }],
  };
  if (replyTo) message.replyTo = [{ emailAddress: { address: replyTo } }];

  const resp = await fetch(`https://graph.microsoft.com/v1.0/users/${senderEmail()}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });
  if (resp.status !== 202) throw new Error(`Graph send failed: ${resp.status} - ${await resp.text()}`);
  return true;
}

module.exports = { businessEmail, senderEmail, isMailConfigured, getGraphAccessToken, sendGraphMail, TESTING_MODE };
