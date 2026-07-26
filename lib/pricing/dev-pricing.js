// lib/pricing/dev-pricing.js
// ============================================================================
// Server-gated developer/test pricing.
// ============================================================================
// The browser may REQUEST a test price (for testing real orders end-to-end),
// but it can never set the price on its own. The server only honours it when
// the supplied code matches a server-only secret (PAYPAL_TEST_MODE_SECRET).
// Per product decision, the validated request may specify the amount; the
// server still validates/clamps it. A raw boolean with no valid secret does
// nothing — the full recomputed price is charged.
//
// Env:
//   PAYPAL_TEST_MODE_SECRET  - required to enable the test path at all
//   PAYPAL_TEST_AMOUNT       - fallback amount if the client sends none (default 0.20)
//   PAYPAL_TEST_MAX_AMOUNT   - safety ceiling for a client-supplied amount (default 5.00)
// ============================================================================

const { toAmountString } = require('./money');

/**
 * Decide whether server-gated test pricing applies.
 * @param {{requested?:boolean, code?:string, amount?:string|number}} devMode
 * @returns {{active:boolean, amountValue?:string, reason?:string}}
 */
function resolveDevPricing(devMode) {
  if (!devMode || !devMode.requested) return { active: false };

  const secret = process.env.PAYPAL_TEST_MODE_SECRET;
  if (!secret) {
    // Test path is disabled unless a server secret is configured.
    return { active: false, reason: 'test-mode-not-configured' };
  }
  if (!devMode.code || devMode.code !== secret) {
    // Invalid/absent code — ignore the request, charge full price.
    return { active: false, reason: 'invalid-test-code' };
  }

  const fallback = process.env.PAYPAL_TEST_AMOUNT || '0.20';
  const maxAmount = parseFloat(process.env.PAYPAL_TEST_MAX_AMOUNT || '5.00');

  let amount = devMode.amount !== undefined && devMode.amount !== null
    ? parseFloat(devMode.amount)
    : parseFloat(fallback);

  if (!Number.isFinite(amount) || amount <= 0) amount = parseFloat(fallback);
  if (amount > maxAmount) amount = maxAmount; // clamp — never let a big amount slip through as "test"

  return { active: true, amountValue: toAmountString(amount) };
}

module.exports = { resolveDevPricing };
