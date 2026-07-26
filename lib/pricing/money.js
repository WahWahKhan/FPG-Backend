// lib/pricing/money.js
// Money helpers. All server pricing is done in AUD. We mirror the client's
// float arithmetic exactly (so the server total equals what the customer saw),
// and only format to a fixed 2-decimal string for the PayPal charge and for
// capture-time reconciliation (compare as strings to avoid float drift).

/** Round to 2 decimals, half-up, guarding against binary FP artefacts. */
function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** Fixed 2-decimal string, e.g. 12.845 -> "12.85". Used for the PayPal amount. */
function toAmountString(n) {
  return Number(n).toFixed(2);
}

/** True if two money values are equal to the cent (string-compared, same scale). */
function equalToCent(a, b) {
  return toAmountString(a) === toAmountString(b);
}

module.exports = { round2, toAmountString, equalToCent };
