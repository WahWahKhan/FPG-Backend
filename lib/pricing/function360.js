// lib/pricing/function360.js
// ============================================================================
// FUNCTION360 hydraulic function kit — SERVER-SIDE AUTHORITATIVE PRICING
// ============================================================================
// Prices are VARIANT-based (per horsepower + function type), not a flat rate.
// This mirrors the configurator: each component page picks a variant key from
// the equipment selection and reads that variant's price from the component
// JSON. The JSON files here are copied verbatim from the frontend
// (data/function360/*.json), and the variant-key functions are ported exactly
// from the six component pages (pages/suite360/function360/*.tsx).
//
// The client sends only { selectedComponents (bool map), equipment }. We
// recompute every component price from the JSON — the client's stored
// componentPrices/totalPrice are ignored.
// ============================================================================

const { round2 } = require('./money');
const { PricingError } = require('./errors');

const diverterValve = require('./data/function360/diverter-valve.json');
const quickCouplings = require('./data/function360/quick-couplings.json');
const adaptors = require('./data/function360/adaptors.json');
const hydraulicHoses = require('./data/function360/hydraulic-hoses.json');
const electrical = require('./data/function360/electrical.json');
const mountingBrackets = require('./data/function360/mounting-brackets.json');

// --- Variant-key selectors, ported verbatim from the component pages. ---

function getDiverterValveVariant(horsepower, functionType) {
  if (!horsepower || !functionType) return 'electric_3rd_below_50hp';
  const hpSuffix = horsepower === 'below_50hp' ? 'below_50hp' : 'above_50hp';
  if (functionType === 'live_3rd') return `live_3rd_${hpSuffix}`;
  if (functionType === 'electric_3rd_4th') return `electric_3rd_4th_${hpSuffix}`;
  return `electric_3rd_${hpSuffix}`;
}

function getQuickCouplingsVariant(horsepower, functionType) {
  if (!horsepower || !functionType) return 'default_below_50hp';
  const hpSuffix = horsepower === 'below_50hp' ? 'below_50hp' : 'above_50hp';
  if (functionType === 'electric_3rd_4th') return `electric_3rd_4th_${hpSuffix}`;
  return `default_${hpSuffix}`;
}

function getAdaptorsVariant(horsepower) {
  if (!horsepower) return 'below_50hp';
  return horsepower === 'above_50hp' ? 'above_50hp' : 'below_50hp';
}

function getHydraulicHosesVariant(horsepower) {
  if (!horsepower) return 'below_50hp';
  return horsepower === 'above_50hp' ? 'above_50hp' : 'below_50hp';
}

function getElectricalVariant(functionType) {
  if (!functionType) return 'electric_3rd';
  return functionType === 'electric_3rd_4th' ? 'electric_3rd_4th' : 'electric_3rd';
}

function getMountingBracketsVariant(functionType) {
  if (!functionType) return 'default';
  return functionType === 'electric_3rd_4th' ? 'electric_3rd_4th' : 'default';
}

// Map cart component key -> { data JSON, variant selector }.
const COMPONENTS = {
  diverterValve: { data: diverterValve, variant: (hp, ft) => getDiverterValveVariant(hp, ft) },
  quickCouplings: { data: quickCouplings, variant: (hp, ft) => getQuickCouplingsVariant(hp, ft) },
  adaptors: { data: adaptors, variant: (hp) => getAdaptorsVariant(hp) },
  hydraulicHoses: { data: hydraulicHoses, variant: (hp) => getHydraulicHosesVariant(hp) },
  electrical: { data: electrical, variant: (_hp, ft) => getElectricalVariant(ft) },
  mountingBrackets: { data: mountingBrackets, variant: (_hp, ft) => getMountingBracketsVariant(ft) },
};

/**
 * Price one FUNCTION360 line from { selectedComponents, equipment }.
 * Returns { amount, breakdown, swellProductIds }.
 */
function priceFunction360Line(item) {
  const selected = (item && item.selectedComponents) || {};
  const equipment = (item && item.equipment) || {};
  const hp = equipment.horsepower ?? null;
  const ft = equipment.functionType ?? null;

  let total = 0;
  const swellProductIds = [];
  const parts = [];

  for (const key of Object.keys(COMPONENTS)) {
    if (!selected[key]) continue;
    const { data, variant } = COMPONENTS[key];
    const variantKey = variant(hp, ft);
    const v = data.variants && data.variants[variantKey];
    if (!v || v.price === undefined) {
      throw new PricingError(
        `function360: no variant "${variantKey}" for component "${key}"`,
        { component: key, variantKey }
      );
    }
    const price = Number(v.price);
    total += price;
    if (v.swellProductId) swellProductIds.push(v.swellProductId);
    parts.push({ component: key, variantKey, price, swellProductId: v.swellProductId || null });
  }

  if (parts.length === 0) {
    throw new PricingError('function360: no components selected');
  }

  return { amount: round2(total), breakdown: { parts }, swellProductIds };
}

module.exports = { priceFunction360Line };
