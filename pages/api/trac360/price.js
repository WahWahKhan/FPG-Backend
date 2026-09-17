// pages/api/trac360/price.js
// POST { config } -> { currency, amount, breakdown }
// config: { operationTypeId, circuitId, addons: [{ id, selectedSubOptionId }] }
// Read-only: runs the SAME priceTrac360Line() that checkout's priceCart() runs.
// Never calls PayPal, never writes to Redis.

const { applyCors, rejectMethod } = require('../../../lib/tube360/http');
const { priceTrac360Line } = require('../../../lib/pricing/trac360');
const { PricingError } = require('../../../lib/pricing/errors');

export default async function handler(req, res) {
  if (applyCors(req, res, ['POST'])) return;
  if (rejectMethod(req, res, ['POST'])) return;

  const { config } = req.body || {};
  try {
    const priced = priceTrac360Line({ kind: 'trac360', cartId: 0, config });
    return res.status(200).json({
      currency: 'AUD',
      amount: priced.amount,
      breakdown: priced.breakdown,
      swellProductIds: priced.swellProductIds,
    });
  } catch (err) {
    if (err instanceof PricingError) {
      return res.status(400).json({ error: err.message.replace(/^trac360: /, '') });
    }
    console.error('[ERR] trac360 price failed:', err);
    return res.status(500).json({ error: 'Could not calculate the price. Please try again.' });
  }
}
