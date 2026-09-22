// pages/api/alerts/email-failure.js
// ============================================================================
// QStash failure callback for /api/send-email. QStash calls THIS endpoint
// (from Upstash's own infrastructure - not the backend calling itself) once
// it has retried the original job 3 times (Upstash-Retries: 3) and every
// attempt still failed - see lib/qstash-helper.js::pushToQStash().
//
// At that point the order was captured (the customer WAS charged) but the
// confirmation email almost certainly never reached them, and given emails
// go out via the same Microsoft Graph account for both customer AND business
// copies, the business's own copy is equally likely to be missing - so this
// alerts over Telegram instead (a completely independent provider from
// Microsoft 365/Graph) using the same bot the InAppChat widget already uses,
// which business staff already monitor.
//
// ASSUMPTION TO VERIFY: the exact JSON shape QStash posts to a failure
// callback (field names below - sourceMessageId/status/url/body as a
// base64-encoded copy of the original request) is based on Upstash's
// documented failure-callback payload at the time this was written, not a
// live test fire against this endpoint. If the real payload differs, the
// try/catch below still logs the raw body and sends a generic-but-real
// alert rather than silently dropping it - but treat the "which order,
// which customer" detail in the first Telegram message as unconfirmed until
// this has actually fired once in practice.
// ============================================================================

const emailFailureStore = require('../../../lib/alerts/email-failure-store');
const { sendTelegramAlert } = require('../../../lib/alerts/telegram');

const VALID_SERVER_KEY = process.env.VALID_SERVER_KEY;

function decodeOriginalOrder(body) {
  // Upstash's documented failure-callback shape carries the original request
  // body as a base64 string under `body`. Defensive: several older/alternate
  // shapes exist across Upstash's SDK versions, so try a couple of fallbacks
  // before giving up.
  const raw = body && (body.body ?? body.Body ?? null);
  if (typeof raw !== 'string') return null;
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch (err) {
    console.warn('[WARN] email-failure alert: could not decode original order from callback body:', err.message);
    return null;
  }
}

function buildAlertText(failurePayload, orderData) {
  const lines = ['\u{1F6A8} EMAIL DELIVERY FAILED (3/3 retries exhausted)'];

  if (orderData) {
    const name = orderData.userDetails
      ? `${orderData.userDetails.firstName || ''} ${orderData.userDetails.lastName || ''}`.trim()
      : null;
    lines.push('');
    lines.push(`Order: ${orderData.orderNumber || 'unknown'}`);
    if (orderData.paypalCaptureID) lines.push(`PayPal capture: ${orderData.paypalCaptureID}`);
    if (name) lines.push(`Customer: ${name}`);
    if (orderData.userDetails?.email) lines.push(`Customer email: ${orderData.userDetails.email}`);
    if (typeof orderData.totals?.total === 'number') {
      lines.push(`Amount charged: A$${orderData.totals.total.toFixed(2)}`);
    }
  } else {
    lines.push('');
    lines.push('(Could not decode order details from the QStash failure payload - see Vercel logs for the raw callback body.)');
    if (failurePayload?.sourceMessageId) lines.push(`QStash message: ${failurePayload.sourceMessageId}`);
    if (failurePayload?.status) lines.push(`Last attempt status: ${failurePayload.status}`);
  }

  lines.push('');
  lines.push('The customer WAS charged but almost certainly never received their confirmation email, and since our business copy goes out via the same email account, we probably never got notified either.');
  lines.push('Please follow up with the customer directly.');
  return lines.join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Same shared-secret pattern as /api/send-email: QStash forwards this
  // header (Upstash-Failure-Callback-Forward-x-server-key, set in
  // pushToQStash()) so this endpoint can't be triggered by a random POST.
  const serverKey = req.headers['x-server-key'];
  if (!VALID_SERVER_KEY) {
    console.error('FATAL: VALID_SERVER_KEY is not configured.');
    return res.status(500).json({ error: 'Server misconfigured' });
  }
  if (serverKey !== VALID_SERVER_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const failurePayload = req.body || {};
  const orderData = decodeOriginalOrder(failurePayload);
  const messageId = failurePayload.sourceMessageId || failurePayload.dlqId || `unkeyed-${Date.now()}`;

  console.error('[ALERT] Email delivery failed after 3 QStash retries:', {
    messageId,
    orderNumber: orderData?.orderNumber,
    status: failurePayload.status,
  });

  const storeReady = emailFailureStore.isConfigured();
  if (!storeReady) {
    console.warn('[WARN] email-failure alert: Upstash not configured, skipping dedupe/audit-log (Telegram alert still attempted).');
  }

  // Audit trail is independent of whether the Telegram send below succeeds -
  // log it regardless so a human can see it happened even if Telegram itself
  // was also down at the time.
  if (storeReady) {
    await emailFailureStore.logFailure({
      messageId,
      orderNumber: orderData?.orderNumber || null,
      customerEmail: orderData?.userDetails?.email || null,
      amount: orderData?.totals?.total ?? null,
      status: failurePayload.status ?? null,
    }).catch((err) => console.error('[ERR] email-failure alert: failed to write audit log:', err));
  }

  if (storeReady) {
    const isFirst = await emailFailureStore.claimAlert(messageId);
    if (!isFirst) {
      console.warn(`[WARN] email-failure alert for ${messageId} already sent once - skipping duplicate Telegram message.`);
      return res.status(200).json({ ok: true, deduped: true });
    }
  }

  try {
    await sendTelegramAlert(buildAlertText(failurePayload, orderData));
    return res.status(200).json({ ok: true });
  } catch (err) {
    // The claim above assumed the alert would go out - since it didn't,
    // release it so a genuine retry of this failure isn't silently
    // swallowed by the dedupe guard.
    if (storeReady) {
      await emailFailureStore.releaseAlert(messageId).catch(() => {});
    }
    // Deliberately still 200: QStash's failure-callback delivery isn't
    // retried the way the main job is, and there is no further fallback to
    // escalate to - the failure is fully logged either way.
    console.error('[ERR] email-failure alert: failed to notify business:', err);
    return res.status(200).json({ ok: false, error: err.message });
  }
}
