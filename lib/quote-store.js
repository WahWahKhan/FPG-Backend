// lib/quote-store.js
// ============================================================================
// Upstash Redis persistence for the checkout server-authority flow.
// ============================================================================
// On Vercel serverless, in-memory Maps (the old processedPayPalOrders /
// orderStatuses) do not survive across instances/invocations, so capture-time
// reconciliation and idempotency MUST be backed by Redis. This module wraps:
//   - the server price QUOTE (keyed by PayPal orderID) — the heart of the fix
//   - idempotency markers (which PayPal orders were already captured)
//   - order status (used by /api/paypal/order-status polling)
//
// Requires env: UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
// (the REST credentials for the same Upstash DB as REDIS_URL).
// ============================================================================

const { Redis } = require('@upstash/redis');

let client = null;

/** Lazily construct the Upstash REST client. Throws if not configured. */
function getRedis() {
  if (client) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      'Quote store unavailable: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN ' +
        '(REST credentials for the same Upstash DB as REDIS_URL).'
    );
  }
  client = new Redis({ url, token });
  return client;
}

const QUOTE_TTL_SECONDS = 30 * 60;        // quotes expire 30 min after create-order
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
const STATUS_TTL_SECONDS = 24 * 60 * 60;
const SAVED_CART_TTL_SECONDS = 30 * 24 * 60 * 60; // "save cart for later" links live 30 days

const quoteKey = (orderID) => `checkout:quote:${orderID}`;
const processedKey = (orderID) => `checkout:processed:${orderID}`;
const statusKey = (orderNumber) => `checkout:status:${orderNumber}`;
const savedCartKey = (token) => `savedcart:${token}`;

// ---- Quote (server-computed price) -----------------------------------------

/**
 * Persist the server quote for a PayPal order. `quote` should contain the
 * authoritative total, breakdown, and the priced line inputs needed later for
 * inventory/invoice/email.
 */
async function saveQuote(orderID, quote) {
  await getRedis().set(quoteKey(orderID), quote, { ex: QUOTE_TTL_SECONDS });
}

/** Load the server quote for a PayPal order, or null if missing/expired. */
async function getQuote(orderID) {
  return (await getRedis().get(quoteKey(orderID))) || null;
}

async function deleteQuote(orderID) {
  await getRedis().del(quoteKey(orderID));
}

// ---- Idempotency -----------------------------------------------------------

async function isOrderProcessed(orderID) {
  return Boolean(await getRedis().get(processedKey(orderID)));
}

async function markOrderProcessed(orderID, internalOrderNumber) {
  await getRedis().set(
    processedKey(orderID),
    { internalOrderNumber, timestamp: new Date().toISOString() },
    { ex: IDEMPOTENCY_TTL_SECONDS }
  );
}

async function getProcessedRecord(orderID) {
  return (await getRedis().get(processedKey(orderID))) || null;
}

// ---- Order status (for polling) --------------------------------------------

async function setOrderStatus(orderNumber, status, extra = {}) {
  const existing = (await getRedis().get(statusKey(orderNumber))) || {};
  const record = { ...existing, status, ...extra, updatedAt: new Date().toISOString() };
  await getRedis().set(statusKey(orderNumber), record, { ex: STATUS_TTL_SECONDS });
  return record;
}

async function updateOrderStatus(orderNumber, extra = {}) {
  const existing = (await getRedis().get(statusKey(orderNumber))) || {};
  const record = { ...existing, ...extra, updatedAt: new Date().toISOString() };
  await getRedis().set(statusKey(orderNumber), record, { ex: STATUS_TTL_SECONDS });
  return record;
}

async function getOrderStatus(orderNumber) {
  return (await getRedis().get(statusKey(orderNumber))) || null;
}

// ---- Saved cart ("save cart for later") ------------------------------------
// Anonymous: keyed by an opaque random token, NOT by any customer identity.
// Stores only the cart contents (price-less identifiers + configurator
// selections + PDF references) so a resume link can rehydrate the cart. No
// name/email is persisted here.

async function saveSavedCart(token, data) {
  await getRedis().set(savedCartKey(token), data, { ex: SAVED_CART_TTL_SECONDS });
}

/** Load a saved cart by token, or null if missing/expired. */
async function getSavedCart(token) {
  return (await getRedis().get(savedCartKey(token))) || null;
}

/** True if Redis REST credentials are present (used to guard the new flow). */
function isConfigured() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

module.exports = {
  saveQuote,
  getQuote,
  deleteQuote,
  isOrderProcessed,
  markOrderProcessed,
  getProcessedRecord,
  setOrderStatus,
  updateOrderStatus,
  getOrderStatus,
  saveSavedCart,
  getSavedCart,
  isConfigured,
};
