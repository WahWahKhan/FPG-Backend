// lib/pricing/tube360.js
// ============================================================================
// TUBE360 custom bent tube - SERVER-SIDE AUTHORITATIVE PRICING + VALIDATION
// ============================================================================
// Unlike the other configurators there is NO frontend copy of this formula.
// The Tube360 summary page asks POST /api/tube360/price for the number it
// shows, and checkout reprices through priceCart() -> this file. One formula,
// one place.
//
// The client sends only the price-less spec:
//   { catalogId, endA, endB, totalLengthMm, quantity,
//     bendRadiusMm, sectionsMm[], anglesDeg[] }
//
// Formula (all AUD ex-GST; rates from data/tube360/rates.json):
//   band        = size band of the tube OD (small / medium / large)
//   material    = SwellPricePerMetre x (totalLengthMm + materialAllowanceMm) / 1000
//   bending     = bends x bendRatePerBend[band] x complexityMultiplier(bends)
//   ends        = endRatePerEnd[endA][band] + endRatePerEnd[endB][band]
//   perTube     = material + bending + ends
//   setupFee    = bends > 0 ? setupFeePerLine : 0      (once per cart line)
//   amount      = perTube x quantity + setupFee
//
// Tube360 NEVER touches Swell inventory: swellProductIds is always [] so
// capture-order has nothing to decrement.
// ============================================================================

const { round2 } = require('./money');
const { PricingError } = require('./errors');
const { fetchSwellUnitPrice } = require('./website');
const cfg = require('../tube360/config');

const isInt = (n) => Number.isInteger(n);
const isFiniteNumber = (n) => typeof n === 'number' && Number.isFinite(n);
// One decimal place at most (e.g. 45 or 45.5, not 45.25). Float-safe.
const hasAtMostOneDecimal = (n) => Math.abs(n * 10 - Math.round(n * 10)) < 1e-9;

/**
 * Validate a Tube360 spec against the catalogue + machine limits.
 * Throws PricingError (-> HTTP 400, fail closed) on the first problem.
 *
 * @param {object} spec
 * @param {{ requireBends?: boolean }} opts  requireBends=false for the
 *        upload-for-quote flow, which has no bend schedule.
 * @returns {{ entry: object }} the catalogue row
 */
function validateTube360Spec(spec, { requireBends = true } = {}) {
  if (!spec || typeof spec !== 'object') {
    throw new PricingError('tube360: missing tube specification');
  }
  const entry = cfg.getCatalogEntry(spec.catalogId);
  if (!entry) {
    throw new PricingError(`tube360: unknown tube "${spec.catalogId}"`);
  }
  const m = cfg.machine;

  for (const key of ['endA', 'endB']) {
    if (!entry.allowedEnds.includes(spec[key])) {
      throw new PricingError(`tube360: ${key} "${spec[key]}" is not available for ${entry.id}`);
    }
  }

  const total = spec.totalLengthMm;
  if (!isInt(total) || total < m.minTotalLengthMm || total > m.maxTotalLengthMm) {
    throw new PricingError(
      `tube360: total length must be a whole number between ${m.minTotalLengthMm} and ${m.maxTotalLengthMm} mm`
    );
  }

  const qty = spec.quantity;
  if (!isInt(qty) || qty < 1 || qty > m.maxQuantity) {
    throw new PricingError(`tube360: quantity must be between 1 and ${m.maxQuantity}`);
  }

  if (!requireBends) return { entry };

  const sections = spec.sectionsMm;
  const angles = spec.anglesDeg;
  if (!Array.isArray(sections) || !Array.isArray(angles)) {
    throw new PricingError('tube360: missing bend schedule');
  }
  if (angles.length > m.maxBends) {
    throw new PricingError(`tube360: maximum ${m.maxBends} bends`);
  }
  if (sections.length !== angles.length + 1) {
    throw new PricingError('tube360: there must be exactly one more section than bends');
  }
  sections.forEach((s, i) => {
    if (!isInt(s) || s < entry.minSectionMm) {
      throw new PricingError(`tube360: section ${i + 1} must be a whole number of at least ${entry.minSectionMm} mm`);
    }
  });
  const sum = sections.reduce((a, b) => a + b, 0);
  if (sum !== total) {
    throw new PricingError(`tube360: sections add up to ${sum} mm but the total length is ${total} mm`);
  }
  angles.forEach((a, i) => {
    if (!isFiniteNumber(a) || !hasAtMostOneDecimal(a) || a < m.minBendAngleDeg || a > m.maxBendAngleDeg) {
      throw new PricingError(
        `tube360: bend ${i + 1} angle must be between ${m.minBendAngleDeg} and ${m.maxBendAngleDeg} degrees (max 1 decimal place)`
      );
    }
  });
  if (angles.length > 0) {
    const r = spec.bendRadiusMm;
    if (!isInt(r) || r < entry.minClrMm || r > entry.maxClrMm) {
      throw new PricingError(
        `tube360: bend radius must be a whole number between ${entry.minClrMm} and ${entry.maxClrMm} mm for ${entry.id}`
      );
    }
  }
  return { entry };
}

/**
 * Price one TUBE360 line.
 * @param {{ kind: 'tube360', cartId?: number, spec: object }} item
 * @param {{ getUnitPrice?: (swellProductId: string) => Promise<number> }} deps
 *        Test seam only - production always uses the live Swell price.
 */
async function priceTube360Line(item, deps = {}) {
  const spec = item && item.spec;
  const { entry } = validateTube360Spec(spec, { requireBends: true });

  const getUnitPrice = deps.getUnitPrice || fetchSwellUnitPrice;
  const pricePerMetre = Number(await getUnitPrice(entry.swellProductId));
  if (!Number.isFinite(pricePerMetre) || pricePerMetre <= 0) {
    throw new PricingError(`tube360: no valid Swell price for ${entry.id}`);
  }

  const r = cfg.rates;
  const band = cfg.bandForOd(entry.odMm);
  const bendCount = spec.anglesDeg.length;

  const bendRate = r.bendRatePerBend[band];
  const endARate = r.endRatePerEnd[spec.endA] && r.endRatePerEnd[spec.endA][band];
  const endBRate = r.endRatePerEnd[spec.endB] && r.endRatePerEnd[spec.endB][band];
  if (![bendRate, endARate, endBRate, r.setupFeePerLine].every(Number.isFinite)) {
    throw new PricingError(`tube360: rate table incomplete for band "${band}"`);
  }

  const billedLengthMm = spec.totalLengthMm + (r.materialAllowanceMm || 0);
  const material = round2((pricePerMetre * billedLengthMm) / 1000);
  const multiplier = cfg.complexityMultiplier(bendCount);
  const bending = round2(bendCount * bendRate * multiplier);
  const endA = round2(endARate);
  const endB = round2(endBRate);
  const perTube = round2(material + bending + endA + endB);
  const tubesSubtotal = round2(perTube * spec.quantity);
  const setupFee = bendCount > 0 ? round2(r.setupFeePerLine) : 0;
  const amount = round2(tubesSubtotal + setupFee);

  const normalizedSpec = {
    catalogId: entry.id,
    endA: spec.endA,
    endB: spec.endB,
    totalLengthMm: spec.totalLengthMm,
    quantity: spec.quantity,
    bendRadiusMm: bendCount > 0 ? spec.bendRadiusMm : null,
    sectionsMm: spec.sectionsMm.slice(),
    anglesDeg: spec.anglesDeg.slice(),
  };

  return {
    amount,
    name: 'TUBE360 Custom Tube',
    quantity: 1,
    // Deliberately empty: Tube360 does not decrement Swell stock.
    swellProductIds: [],
    // Existing Steel Tubes freight rule (lib/pricing/index.js): one physical
    // piece longer than the threshold switches the order to special freight.
    isSteelTubesLineOverLength: spec.totalLengthMm > r.oversizeFreightThresholdMm,
    breakdown: {
      spec: normalizedSpec,
      labels: cfg.labelsFor(entry, spec),
      band,
      material: {
        sku: entry.id,
        pricePerMetre: round2(pricePerMetre),
        billedLengthMm,
        cost: material,
      },
      bending: { count: bendCount, ratePerBend: bendRate, multiplier, cost: bending },
      ends: {
        endA: { type: spec.endA, cost: endA },
        endB: { type: spec.endB, cost: endB },
      },
      perTube,
      quantity: spec.quantity,
      tubesSubtotal,
      setupFee,
      total: amount,
    },
  };
}

module.exports = {
  priceTube360Line,
  validateTube360Spec,
};
