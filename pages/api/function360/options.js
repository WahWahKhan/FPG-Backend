// pages/api/function360/options.js
// GET - customer-safe Function360 configurator catalogue (component variants +
// equipment options). Mirrors the Tube360/Trac360 pattern: the frontend reads
// its dropdowns/cards from this response instead of holding its own JSON copy.
//
// Note: equipment-options.json (horsepower/functionType labels) previously
// only existed on the frontend as pure catalogue data (no prices). It was
// copied verbatim into lib/pricing/data/function360/ as part of this
// consolidation so the backend can now serve it too.

const { applyCors, rejectMethod } = require('../../../lib/tube360/http');

const diverterValve = require('../../../lib/pricing/data/function360/diverter-valve.json');
const quickCouplings = require('../../../lib/pricing/data/function360/quick-couplings.json');
const adaptors = require('../../../lib/pricing/data/function360/adaptors.json');
const hydraulicHoses = require('../../../lib/pricing/data/function360/hydraulic-hoses.json');
const electrical = require('../../../lib/pricing/data/function360/electrical.json');
const mountingBrackets = require('../../../lib/pricing/data/function360/mounting-brackets.json');
const equipmentOptions = require('../../../lib/pricing/data/function360/equipment-options.json');

export default function handler(req, res) {
  if (applyCors(req, res, ['GET'])) return;
  if (rejectMethod(req, res, ['GET'])) return;

  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  return res.status(200).json({
    equipmentOptions,
    components: {
      diverterValve,
      quickCouplings,
      adaptors,
      hydraulicHoses,
      electrical,
      mountingBrackets,
    },
  });
}
