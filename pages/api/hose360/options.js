// pages/api/hose360/options.js
// GET - customer-safe Hose360 configurator catalogue (hose sizes, fitting
// families with shapes/sizes/compatibility matrices, SAE fittings, protection
// options, pressure test options, orientation angles, quantity limits).
// Mirrors the Trac360/Function360 pattern: one options call, cached client-side.

const { applyCors, rejectMethod } = require('../../../lib/tube360/http');
const hoseSizes = require('../../../lib/pricing/data/hose360/hose-sizes.json');
const bspFittings = require('../../../lib/pricing/data/hose360/bsp-fittings.json');
const jicFittings = require('../../../lib/pricing/data/hose360/jic-fittings.json');
const metricFittings = require('../../../lib/pricing/data/hose360/metric-fittings.json');
const orfsFittings = require('../../../lib/pricing/data/hose360/orfs-fittings.json');
const saeFittings = require('../../../lib/pricing/data/hose360/sae-fittings.json');
const protectionAndPressure = require('../../../lib/pricing/data/hose360/protection-and-pressure-options.json');

export default function handler(req, res) {
  if (applyCors(req, res, ['GET'])) return;
  if (rejectMethod(req, res, ['GET'])) return;
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  return res.status(200).json({
    hoseSizes,
    fittingFamilies: { bsp: bspFittings, jic: jicFittings, metric: metricFittings, orfs: orfsFittings },
    saeFittings,
    protectionOptions: protectionAndPressure.protectionOptions,
    pressureTestOptions: protectionAndPressure.pressureTestOptions,
    orientationAngles: protectionAndPressure.orientationAngles,
    quantityLimits: protectionAndPressure.quantityLimits,
  });
}
