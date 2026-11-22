// lib/email/delivery-store.js
// ============================================================================
// Remembers which half of an order's emails has already been delivered, and
// how, so a QStash retry never re-sends what already went out:
//
//   email:delivered:<orderNumber>  -> hash { customer: "graph"|"postmark", business: "graph"|"telegram" }
//
// Kept 7 days. Same Upstash DB as lib/quote-store.js. If Redis is not
// configured or errors, every call degrades to "nothing recorded" - the worst
// case is a duplicate email, never a missing one.
// ============================================================================

const { Redis } = require('@upstash/redis');

const TTL_SECONDS = 7 * 24 * 60 * 60;
let client = null;

function redis() {
  if (client) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  client = new Redis({ url, token });
  return client;
}

const key = (orderNumber) => `email:delivered:${orderNumber}`;

/** @returns {Promise<{customer?: string, business?: string}>} */
async function getDelivered(orderNumber) {
  const r = redis();
  if (!r || !orderNumber) return {};
  try {
    return (await r.hgetall(key(orderNumber))) || {};
  } catch (e) {
    console.error('[WARN] delivery-store read failed:', e.message);
    return {};
  }
}

/** Record that `part` ("customer" | "business") was delivered `via` a channel. */
async function markDelivered(orderNumber, part, via) {
  const r = redis();
  if (!r || !orderNumber) return;
  try {
    await r.hset(key(orderNumber), { [part]: via });
    await r.expire(key(orderNumber), TTL_SECONDS);
  } catch (e) {
    console.error('[WARN] delivery-store write failed:', e.message);
  }
}

module.exports = { getDelivered, markDelivered };
