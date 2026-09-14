// pages/api/tube360/options.js
// GET - customer-safe Tube360 configurator options (catalogue, machine
// limits, upload rules). The frontend renders every dropdown and every limit
// from this response; it has no copy of its own.

import { applyCors, rejectMethod } from '../../../lib/tube360/http';
import { publicOptions } from '../../../lib/tube360/config';
import { STEEL_TUBES_SHIPPING } from '../../../lib/pricing';

export default function handler(req, res) {
  if (applyCors(req, res, ['GET'])) return;
  if (rejectMethod(req, res, ['GET'])) return;

  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  return res.status(200).json(publicOptions(STEEL_TUBES_SHIPPING));
}
