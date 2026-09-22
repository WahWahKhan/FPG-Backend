// lib/alerts/email-failure-store.js
// ============================================================================
// Upstash Redis persistence for the email-delivery-failure alert (same
// Upstash DB as the quote store / Tube360 uploads - see lib/quote-store.js).
//
// alerts:email-failure:sent:<messageId>  -> "1", TTL 24h
//   Dedupe guard: QStash can in principle re-attempt its own failure callback,
//   and this endpoint must never send the business a duplicate Telegram alert
//   for the same underlying failure.
//
// alerts:email-failure:log  -> a capped list of recent failures (audit trail,
//   NOT the notification mechanism itself - the business is alerted via
//   Telegram; this is just so a human can later check "how often has this
//   actually happened" without digging through Vercel logs).
// ============================================================================

const { Redis } = require('@upstash/redis');

let client = null;
function redis() {
  if (client) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Upstash not configured (UPSTASH_REDIS_REST_URL / _TOKEN)');
  client = new Redis({ url, token });
  return client;
}

function isConfigured() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

const DEDUPE_TTL_SECONDS = 24 * 60 * 60;
const LOG_KEY = 'alerts:email-failure:log';
const LOG_MAX_ENTRIES = 500;

/** True the FIRST time this is called for a given messageId; false on any repeat. */
async function claimAlert(messageId) {
  const result = await redis().set(`alerts:email-failure:sent:${messageId}`, '1', {
    nx: true,
    ex: DEDUPE_TTL_SECONDS,
  });
  return result === 'OK';
}

/**
 * Undo a claim when the alert it guarded did NOT actually go out (e.g. the
 * Telegram send itself failed) - otherwise a transient Telegram outage would
 * permanently suppress the alert for that message on every future retry.
 */
async function releaseAlert(messageId) {
  await redis().del(`alerts:email-failure:sent:${messageId}`);
}

/** Append one failure record to the capped audit-trail list. Best-effort. */
async function logFailure(record) {
  await redis().lpush(LOG_KEY, JSON.stringify({ ...record, loggedAt: new Date().toISOString() }));
  await redis().ltrim(LOG_KEY, 0, LOG_MAX_ENTRIES - 1);
}

module.exports = { isConfigured, claimAlert, releaseAlert, logFailure };
