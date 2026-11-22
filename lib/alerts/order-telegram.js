// lib/alerts/order-telegram.js
// ============================================================================
// Business copy of an order, sent to the owner's Telegram when the business
// order email cannot go out through Microsoft Graph (outage, 5xx, expired
// Azure secret...). Carries the order header + customer details (the format
// the owner specified, 2026-11-15) followed by every PDF that would have been
// attached to the business email.
// ============================================================================

const { sendTelegramAlert, sendTelegramDocument } = require('./telegram');

function orderDateMelbourne(date = new Date()) {
  return date.toLocaleDateString('en-AU', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Australia/Melbourne',
  });
}

function formatAddress(u = {}) {
  const cityLine = [u.city, [u.state, u.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [u.address, cityLine, u.country].filter(Boolean).join(', ');
}

/** Plain-text order message in the owner's format. */
function buildOrderTelegramText({ orderNumber, paypalCaptureID, userDetails = {}, testingMode, reason }) {
  const name = [userDetails.firstName, userDetails.lastName].filter(Boolean).join(' ');
  const lines = [
    `${testingMode ? '[TEST] ' : ''}NEW ORDER - business email could not be sent${reason ? ` (${reason})` : ''}`,
    '',
    `Order Number: #${orderNumber}`,
    `Order Date: ${orderDateMelbourne()}`,
    `PayPal Transaction ID: ${paypalCaptureID || 'N/A'}`,
    'Customer Information',
    '',
    `Name: ${name || 'N/A'}`,
  ];
  if (userDetails.companyName) lines.push(`Company: ${userDetails.companyName}`);
  lines.push(
    `Email: ${userDetails.email || 'N/A'}`,
    `Phone: ${userDetails.phone || 'N/A'}`,
    `Address: ${formatAddress(userDetails) || 'N/A'}`
  );
  return lines.join('\n');
}

/**
 * Send the order message, then each PDF. Throws if the message or ANY PDF
 * fails, so the caller can retry the whole business copy (a resend may repeat
 * the text, which is better than a missing PDF).
 */
async function sendOrderToTelegram(payload, attachments = []) {
  await sendTelegramAlert(buildOrderTelegramText(payload));
  for (let i = 0; i < attachments.length; i++) {
    const file = attachments[i];
    await sendTelegramDocument(file, `Order #${payload.orderNumber} - ${i + 1} of ${attachments.length}`);
  }
  return { messages: 1 + attachments.length };
}

module.exports = { buildOrderTelegramText, sendOrderToTelegram, orderDateMelbourne };
