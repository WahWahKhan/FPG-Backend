// lib/tube360/upload-store.js
// ============================================================================
// Upstash Redis state for in-progress Tube360 uploads (same Upstash database
// as the checkout quote store and saved carts).
// ============================================================================
// tube360:upload:<uploadId>  ->  { uploadUrl, size, name, safeName, nextOffset,
//                                  status: 'uploading' | 'done', itemId, createdAt }
//   TTL uploads.uploadSessionTtlHours (refreshed on every chunk).
//   The Graph uploadUrl never leaves the server.
//   Deleted once the quote is submitted (single use).
//
// tube360:cleanup-lock  ->  SET NX with a 24 h expiry, so the _incoming
//   cleanup runs at most once a day without any scheduler / cron.
// ============================================================================

const { Redis } = require('@upstash/redis');
const cfg = require('./config');

let client = null;
function redis() {
  if (client) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Upstash not configured (UPSTASH_REDIS_REST_URL / _TOKEN)');
  client = new Redis({ url, token });
  return client;
}

const key = (uploadId) => `tube360:upload:${uploadId}`;
const ttlSeconds = () => cfg.uploads.uploadSessionTtlHours * 60 * 60;

function isConfigured() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

async function saveUpload(uploadId, record) {
  await redis().set(key(uploadId), record, { ex: ttlSeconds() });
}

async function getUpload(uploadId) {
  if (typeof uploadId !== 'string' || !/^[0-9a-f-]{36}$/.test(uploadId)) return null;
  return (await redis().get(key(uploadId))) || null;
}

async function deleteUpload(uploadId) {
  await redis().del(key(uploadId));
}

/** True at most once per 24 h across all server instances. */
async function acquireDailyCleanupLock() {
  const result = await redis().set('tube360:cleanup-lock', new Date().toISOString(), { nx: true, ex: 24 * 60 * 60 });
  return result === 'OK';
}

module.exports = { isConfigured, saveUpload, getUpload, deleteUpload, acquireDailyCleanupLock };
