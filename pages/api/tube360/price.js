// pages/api/tube360/price.js
// POST { spec } -> { currency, amount, breakdown }
// Read-only: runs the SAME priceTube360Line() that checkout's priceCart()
// runs. Never calls PayPal, never writes to Redis (see the knowledge-base
// note: create-order must never be used for quoting).

import { applyCors, rejectMethod } from '../../../lib/tube360/http';
import { priceTube360Line } from '../../../lib/pricing/tube360';
import { PricingError } from '../../../lib/pricing/errors';

export default async function handler(req, res) {
  if (applyCors(req, res, ['POST'])) return;
  if (rejectMethod(req, res, ['POST'])) return;

  const { spec } = req.body || {};
  try {
    const priced = await priceTube360Line({ kind: 'tube360', cartId: 0, spec });
    return res.status(200).json({ currency: 'AUD', amount: priced.amount, breakdown: priced.breakdown });
  } catch (err) {
    if (err instanceof PricingError) {
      return res.status(400).json({ error: err.message.replace(/^tube360: /, '') });
    }
    console.error('[ERR] tube360 price failed:', err);
    return res.status(500).json({ error: 'Could not calculate the price. Please try again.' });
  }
}
