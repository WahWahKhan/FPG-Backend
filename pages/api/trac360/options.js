// pages/api/trac360/options.js
// GET - customer-safe Trac360 configurator catalogue (operation types, circuits,
// addons + sub-options, tractor brands/models, valve setups). Mirrors the
// Tube360 pattern (pages/api/tube360/options.js): the frontend renders every
// dropdown/card from this response instead of holding its own copy of the
// pricing-bearing JSON files.

const { applyCors, rejectMethod } = require('../../../lib/tube360/http');

const operationTypes = require('../../../lib/pricing/data/trac360/operation-types.json');
const circuits = require('../../../lib/pricing/data/trac360/circuits.json');
const addons = require('../../../lib/pricing/data/trac360/addons.json');
const tractors = require('../../../lib/pricing/data/trac360/tractors.json');
const valveSetups = require('../../../lib/pricing/data/trac360/valve-setups.json');

export default function handler(req, res) {
  if (applyCors(req, res, ['GET'])) return;
  if (rejectMethod(req, res, ['GET'])) return;

  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  return res.status(200).json({
    operationTypes,
    circuits,
    addons,
    tractors,
    valveSetups,
  });
}
