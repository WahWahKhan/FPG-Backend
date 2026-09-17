// lib/paypal/env.js
// ============================================================================
// ONE shared CORS + sandbox-vs-live decision point for all four /api/paypal/*
// routes (create-order, capture-order, order-status, quote). Before this file
// existed, each route had its own, independently copy-pasted CORS block and
// (for create-order/capture-order) its own sandbox-vs-live credential logic -
// they had already drifted from each other. See
// TUBE360_PLAN/05_PAYPAL_PREVIEW_TESTING_PLAN.md §2 for the full writeup.
// ============================================================================

const { isAllowedOrigin } = require('../tube360/http');

const PROD_SITE_URL = 'https://fluidpowergroup.com.au';

/**
 * Apply CORS headers using the SAME allowlist (including the real Vercel
 * preview-deployment patterns) every other backend route already uses via
 * lib/tube360/http.js - so the two new preview-testing lane branches
 * (plan §1) only ever need their git-alias hostnames added in ONE place.
 *
 * Unlike the old per-route copies, an origin that is NOT on the allowlist
 * gets the production site URL echoed back, never '*' or a blind reflect of
 * whatever Origin the caller sent - the old fallback was flagged in the plan
 * as an accidentally wide-open CORS policy on price-creating endpoints, not
 * a deliberate one. A request with no Origin header at all (server-to-server
 * calls, curl, PayPal webhooks) is not subject to CORS enforcement by
 * browsers anyway, so this fallback is inert for those callers.
 *
 * @param {{ methods: string[], credentials?: boolean, optionsStatus?: 200|204 }} opts
 *   `credentials`/`optionsStatus` preserve each route's exact prior response
 *   shape (create-order/quote never sent Allow-Credentials and answered
 *   OPTIONS with 204; capture-order/order-status sent Allow-Credentials and
 *   answered OPTIONS with 200) - this refactor changes only the CORS
 *   *policy*, never response shapes or status codes, per the plan's B1
 *   acceptance criteria.
 * @returns {boolean} true if this request was an OPTIONS preflight and has
 *   already been answered - the caller must `return` immediately.
 */
function applyPayPalCors(req, res, { methods, credentials = false, optionsStatus = 204 }) {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else {
    res.setHeader('Access-Control-Allow-Origin', PROD_SITE_URL);
  }
  res.setHeader('Access-Control-Allow-Methods', [...methods, 'OPTIONS'].join(', '));
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-server-key');
  if (credentials) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') {
    res.status(optionsStatus).end();
    return true;
  }
  return false;
}

/**
 * ONE decision point for which PayPal app (sandbox vs live) and which
 * credential pair a request should use. create-order and capture-order both
 * call this so they can never disagree about which PayPal app owns a given
 * order (plan §2's "real inconsistency" finding).
 *
 * The legacy TESTING_MODE=true + `_TEST`-suffixed credential path (used only
 * by capture-order historically) is preserved BYTE-FOR-BYTE when
 * TESTING_MODE is set, so existing local/legacy behaviour does not change -
 * it now just goes through this single function instead of a second,
 * independently-maintained copy of the sandbox/live decision that could
 * silently disagree with create-order's. Whether this legacy path should be
 * retired entirely (in favour of PAYPAL_MODE + the plan's per-branch Vercel
 * env vars) is an open question for the owner (plan §5, item 1) - not
 * decided by this refactor.
 */
function resolvePayPalCredentials() {
  const testingMode = process.env.TESTING_MODE === 'true';

  if (testingMode) {
    const useSandbox = process.env.TEST_USE_SANDBOX !== 'false';
    return {
      useSandbox,
      clientId: useSandbox ? process.env.SANDBOX_CLIENT_ID_TEST : process.env.PRODUCTION_CLIENT_ID_TEST,
      clientSecret: useSandbox ? process.env.SANDBOX_SECRET_TEST : process.env.PRODUCTION_SECRET_TEST,
      apiBase: useSandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com',
    };
  }

  const isVercelPreview = process.env.VERCEL_ENV === 'preview';
  const forceSandbox = process.env.PAYPAL_MODE === 'sandbox';
  const forceProduction = process.env.PAYPAL_MODE === 'production';
  const useSandbox = forceProduction ? false : (forceSandbox || isVercelPreview || process.env.NODE_ENV !== 'production');
  return {
    useSandbox,
    clientId: useSandbox ? process.env.SANDBOX_CLIENT_ID : process.env.PRODUCTION_CLIENT_ID,
    clientSecret: useSandbox ? process.env.SANDBOX_SECRET : process.env.PRODUCTION_SECRET,
    apiBase: useSandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com',
  };
}

module.exports = { applyPayPalCors, resolvePayPalCredentials, PROD_SITE_URL };
