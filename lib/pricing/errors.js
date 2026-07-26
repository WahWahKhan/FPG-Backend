// lib/pricing/errors.js

/**
 * Thrown when a line cannot be priced from trusted data — an unknown id,
 * missing selection, out-of-stock, etc. The API turns this into a 400 and
 * never creates a PayPal order, so a tampered/un-repriceable cart can't check
 * out at all (fail closed).
 */
class PricingError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'PricingError';
    this.details = details || null;
  }
}

module.exports = { PricingError };
