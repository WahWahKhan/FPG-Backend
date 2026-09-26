// pages/api/hose360/price.js
// POST { orderConfig } -> { currency, amount, breakdown, swellProductIds }
// Read-only: runs the SAME priceHose360Line() that checkout's priceCart() runs.
// Never calls PayPal, never writes to Redis.
// priceHose360Line is SYNCHRONOUS (no Swell fetch, unlike Tube360) - no await.

const { applyCors, rejectMethod } = require('../../../lib/tube360/http');
const { priceHose360Line } = require('../../../lib/pricing/hose360');
const { PricingError } = require('../../../lib/pricing/errors');

export default async function handler(req, res) {
  if (applyCors(req, res, ['POST'])) return;
  if (rejectMethod(req, res, ['POST'])) return;
  const { orderConfig } = req.body || {};
  try {
    const priced = priceHose360Line({ kind: 'hose360', cartId: 0, orderConfig });
    return res.status(200).json({
      currency: 'AUD',
      amount: priced.amount,
      breakdown: priced.breakdown,
      swellProductIds: priced.swellProductIds,
    });
  } catch (err) {
    if (err instanceof PricingError) {
      return res.status(400).json({ error: err.message.replace(/^hose360: /, '') });
    }
    console.error('hose360/price error:', err);
    return res.status(500).json({ error: 'Could not calculate the price. Please try again.' });
  }
}
