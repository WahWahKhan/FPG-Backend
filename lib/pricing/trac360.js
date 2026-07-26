// lib/pricing/trac360.js
// ============================================================================
// TRAC360 tractor valve configurator — SERVER-SIDE AUTHORITATIVE PRICING
// ============================================================================
// Faithful port of utils/trac360/pricing.ts::calculatePriceBreakdown, driven
// by the same JSON tables (data/trac360/circuits.json, addons.json) copied
// verbatim from the frontend.
//
//   baseOperationPrice = circuit ? 0 : (operationType ? 1250 : 0)
//   circuitPrice       = CIRCUIT[circuitId].price
//   addonsTotal        = Σ ADDON[id].basePrice (+ selected subOption.additionalPrice)
//   total              = baseOperationPrice + circuitPrice + addonsTotal
//
// The client sends only selection ids (operationTypeId, circuitId,
// addons[{id, selectedSubOptionId}]) — never prices.
// ============================================================================

const { round2 } = require('./money');
const { PricingError } = require('./errors');

const circuits = require('./data/trac360/circuits.json');
const addons = require('./data/trac360/addons.json');

const BASE_OPERATION_PRICE = 1250; // Path A: direct-to-valve base (no circuit)

const CIRCUIT_BY_ID = Object.fromEntries(circuits.map((c) => [c.id, c]));
const ADDON_BY_ID = Object.fromEntries(addons.map((a) => [a.id, a]));

/**
 * Price one TRAC360 line from its selection ids.
 * Returns { amount, breakdown, swellProductIds }.
 */
function priceTrac360Line(item) {
  const cfg = (item && item.config) || {};
  const operationTypeId = cfg.operationTypeId ?? null;
  const circuitId = cfg.circuitId ?? null;
  const addonSelections = Array.isArray(cfg.addons) ? cfg.addons : [];

  // A line with no operation type and no circuit is not a real configuration.
  if (!operationTypeId && !circuitId) {
    throw new PricingError('trac360: missing operationTypeId/circuitId (un-repriceable line)');
  }

  // Path B (a circuit is chosen): circuit price is the full base.
  // Path A (no circuit, operation type only): flat 1250 base.
  const baseOperationPrice = circuitId ? 0 : (operationTypeId ? BASE_OPERATION_PRICE : 0);

  let circuit = null;
  if (circuitId) {
    circuit = CIRCUIT_BY_ID[circuitId];
    if (!circuit) throw new PricingError(`trac360: unknown circuit "${circuitId}"`);
  }
  const circuitPrice = circuit ? Number(circuit.price) || 0 : 0;

  const swellProductIds = [];
  if (circuit && circuit.swellProductId) swellProductIds.push(circuit.swellProductId);

  let addonsTotal = 0;
  const addonParts = [];
  for (const sel of addonSelections) {
    const addon = ADDON_BY_ID[sel.id];
    if (!addon) throw new PricingError(`trac360: unknown addon "${sel.id}"`);

    let addonPrice = Number(addon.basePrice) || 0;
    if (sel.selectedSubOptionId && Array.isArray(addon.subOptions)) {
      const sub = addon.subOptions.find((s) => s.id === sel.selectedSubOptionId);
      if (!sub) {
        throw new PricingError(
          `trac360: unknown sub-option "${sel.selectedSubOptionId}" for addon "${sel.id}"`
        );
      }
      addonPrice += Number(sub.additionalPrice) || 0;
    }
    addonsTotal += addonPrice;
    if (addon.swellProductId) swellProductIds.push(addon.swellProductId);
    addonParts.push({ id: sel.id, subOptionId: sel.selectedSubOptionId || null, price: addonPrice });
  }

  const total = baseOperationPrice + circuitPrice + addonsTotal;

  return {
    amount: round2(total),
    breakdown: { baseOperationPrice, circuitPrice, addonsTotal, addons: addonParts },
    swellProductIds,
  };
}

module.exports = { priceTrac360Line };
