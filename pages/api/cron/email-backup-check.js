// pages/api/cron/email-backup-check.js
// ============================================================================
// Weekly health check of the Postmark backup sender (Vercel Cron, see
// vercel.json). Sends one small email through Postmark; if that fails - token
// revoked, account suspended, plan changed, sender unverified - the owner is
// told on Telegram straight away, long before an outage would need it.
// Uses 4-5 of the free plan's 100 emails a month.
//
// Env: CRON_SECRET (Vercel sends it as "Authorization: Bearer <secret>"),
//      POSTMARK_CHECK_TO (optional; defaults to BUSINESS_EMAIL).
// ============================================================================

const { sendPostmarkEmail, isPostmarkConfigured } = require('../../../lib/email/postmark');
const { sendTelegramAlert } = require('../../../lib/alerts/telegram');

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return res.status(500).json({ ok: false, error: 'CRON_SECRET not set' });
  }
  if (req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const to = process.env.POSTMARK_CHECK_TO || process.env.BUSINESS_EMAIL;
  try {
    if (!isPostmarkConfigured()) throw new Error('POSTMARK_SERVER_TOKEN / POSTMARK_FROM_EMAIL not set');
    if (!to) throw new Error('no recipient (POSTMARK_CHECK_TO / BUSINESS_EMAIL not set)');
    const when = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Melbourne' });
    const result = await sendPostmarkEmail({
      to,
      subject: 'Weekly check: backup email sender is working',
      html: `<p>This is the automatic weekly test of the website's backup email sender (Postmark), sent ${when}.</p>` +
        '<p>No action needed. If these stop arriving, check Postmark and the Telegram chat.</p>',
      tag: 'weekly-backup-check',
    });
    console.log(`[OK] Weekly Postmark check sent (${result.messageId})`);
    return res.status(200).json({ ok: true, messageId: result.messageId });
  } catch (err) {
    console.error('[ERR] Weekly Postmark check failed:', err.message);
    try {
      await sendTelegramAlert(
        'WARNING: the backup email sender (Postmark) failed its weekly check.\n\n' +
        `${err.message}\n\n` +
        'Customer confirmation emails have NO backup until this is fixed. ' +
        'Check the Postmark account (suspended? plan changed? token revoked?).'
      );
    } catch (tgErr) {
      console.error('[ERR] Could not send the Telegram warning either:', tgErr.message);
    }
    return res.status(500).json({ ok: false, error: err.message });
  }
}
