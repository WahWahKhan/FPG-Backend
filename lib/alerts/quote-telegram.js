// lib/alerts/quote-telegram.js
// ============================================================================
// Business copy of a Tube360 quote request, sent to the owner's Telegram when
// the business email cannot go out through Microsoft Graph. Same layout as the
// order copy (lib/alerts/order-telegram.js). The customer's files are already
// in SharePoint, so they are sent as links (staff sign-in), not attachments.
// ============================================================================

const { sendTelegramAlert } = require('./telegram');
const { orderDateMelbourne } = require('./order-telegram');

function buildQuoteTelegramText({ ref, contact = {}, labels = {}, spec = {}, notes, files = [], folderUrl, testingMode, reason }) {
  const address = [contact.address, contact.suburb, [contact.state, contact.postcode].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  const tube = [labels.material, labels.sizeSystem, labels.od, labels.wallMm ? `${labels.wallMm} mm wall` : '', labels.grade]
    .filter(Boolean)
    .join(' / ');
  const lines = [
    `${testingMode ? '[TEST] ' : ''}NEW TUBE360 QUOTE REQUEST - business email could not be sent${reason ? ` (${reason})` : ''}`,
    '',
    `Quote Reference: ${ref}`,
    `Request Date: ${orderDateMelbourne()}`,
    'Customer Information',
    '',
    `Name: ${contact.name || 'N/A'}`,
  ];
  if (contact.companyName) lines.push(`Company: ${contact.companyName}`);
  lines.push(
    `Email: ${contact.email || 'N/A'}`,
    `Phone: ${contact.contactNumber || 'N/A'}`,
    `Address: ${address || 'N/A'}`,
    '',
    'Tube Details',
    '',
    `Tube: ${tube || 'N/A'}`,
    `Ends: ${labels.endA || 'N/A'} / ${labels.endB || 'N/A'}`,
    `Total length: ${spec.totalLengthMm ?? 'N/A'} mm`,
    `Quantity: ${spec.quantity ?? 'N/A'}`
  );
  if (notes) lines.push(`Notes: ${notes}`);
  lines.push('', `Files (${files.length}):`);
  files.forEach((f, i) => lines.push(`${i + 1}. ${f.name}${f.webUrl ? ` - ${f.webUrl}` : ''}`));
  if (folderUrl) lines.push('', `SharePoint folder: ${folderUrl}`);
  return lines.join('\n');
}

/**
 * The "Reply with Quote" link carries the whole request in its URL and can be
 * long, so it goes in its own message - a 4096-char cut would break it.
 */
async function sendQuoteToTelegram(payload) {
  await sendTelegramAlert(buildQuoteTelegramText(payload));
  if (payload.replyQuoteUrl) {
    await sendTelegramAlert(`Reply with Quote for ${payload.ref}:\n${payload.replyQuoteUrl}`);
  }
}

module.exports = { buildQuoteTelegramText, sendQuoteToTelegram };
