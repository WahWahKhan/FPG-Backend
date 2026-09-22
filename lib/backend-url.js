// lib/backend-url.js
// ============================================================================
// Resolves THIS backend deployment's own public URL, for the handful of
// places the backend needs to hand itself a callback URL (QStash's
// /api/send-email job, and in turn its Upstash-Failure-Callback - see
// lib/qstash-helper.js). Previously copy-pasted 3x (capture-order.js once,
// send-cart-email.ts twice) and had already started to drift in whitespace;
// consolidated 2026-09-22 - same class of bug as the CORS-allowlist and
// API_BASE_URL duplication fixed earlier in this project.
//
// Priority: VERCEL_URL (auto-injected by Vercel on every deployment, so this
// is never manually configured and can't go stale) -> API_BASE_URL -> test
// fallback -> hardcoded prod URL.
// ============================================================================

function getBackendCallbackUrl(path) {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}${path}`;
  }
  if (process.env.API_BASE_URL) {
    return `${process.env.API_BASE_URL}${path}`;
  }
  const TESTING_MODE = process.env.TESTING_MODE === 'true';
  if (TESTING_MODE) {
    return process.env.API_BASE_URL_TEST
      ? `${process.env.API_BASE_URL_TEST}${path}`
      : `http://localhost:3001${path}`;
  }
  return `https://fluidpowergroup.com.au${path}`;
}

module.exports = { getBackendCallbackUrl };
