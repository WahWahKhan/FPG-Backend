// pages/api/function360/price.js
// POST { selectedComponents, equipment } -> { currency, amount, breakdown }
// selectedComponents: { diverterValve, quickCouplings, adaptors, hydraulicHoses,
//   electrical, mountingBrackets } (booleans)
// equipment: { horsepower, functionType }
// Read-only: runs the SAME priceFunction360Line() that checkout's priceCart()
// runs. Never calls PayPal, never writes to Redis.

const { applyCors, rejectMethod } = require('../../../lib/tube360/http');
const { priceFunction360Line } = require('../../../lib/pricing/function360');
const { PricingError } = require('../../../lib/pricing/errors');

export default async function handler(req, res) {
  if (applyCors(req, res, ['POST'])) return;
  if (rejectMethod(req, res, ['POST'])) return;

  const { selectedComponents, equipment } = req.body || {};
  try {
    const priced = priceFunction360Line({ kind: 'function360', cartId: 0, selectedComponents, equipment });
    return res.status(200).json({
      currency: 'AUD',
      amount: priced.amount,
      breakdown: priced.breakdown,
      swellProductIds: priced.swellProductIds,
    });
  } catch (err) {
    if (err instanceof PricingError) {
      return res.status(400).json({ error: err.message.replace(/^function360: /, '') });
    }
    console.error('[ERR] function360 price failed:', err);
    return res.status(500).json({ error: 'Could not calculate the price. Please try again.' });
  }
}
