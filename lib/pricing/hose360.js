// lib/pricing/hose360.js
// ============================================================================
// HOSE360 / PWA custom hose assembly — SERVER-SIDE AUTHORITATIVE PRICING
// ============================================================================
// This is a faithful port of the HOSE360 configurator's own pricing logic,
// recovered from the PWA's published source maps (public/suite360). The PWA
// prices from STATIC tables (EXPO_PUBLIC_USE_STATIC) — NOT the get-prices.js
// env values — so these tables are copied verbatim from the PWA source to
// guarantee cent-for-cent parity with what the customer configured.
//
// Formula (from screens/OrderConfirmationScreen1.js::calculatePrices and
// screens/CutLengthsScreen.js for order-fitting mode):
//
//   totalLength(m) = Σ (cut.length_mm / 1000)
//   baseHosePrice  = totalLength * HOSE_UNIT[hoseSize]
//   end1/end2      = adjustPrice(FITTING_BASE[shape→table][size], isOrderFittingMode) * quantity
//   assemblySubtotal ("cutLengthPrice") = baseHosePrice + end1 + end2
//   protection     = 'NOT REQUIRED' ? 0 : assemblySubtotal * (MULT[protection] - 1)
//   pressureTest   = 'Not Required' ? 0 : 10 * quantity
//   shipping       = 0 (added once at website checkout, not per assembly)
//   total          = baseHosePrice + end1 + end2 + protection + pressureTest
//
// NOTE: end fittings are charged PER HOSE (× quantity), and hose protection is a
// % uplift on the FULL assembly subtotal (hose + both fittings), not on the bare
// hose. Ground truth: HoseCalculator screens/CutLengthsScreen.js (fittings×qty)
// and screens/HoseProtectionScreen.js (protection = cutLengthPrice*(mult-1)).
//
//   order-fitting mode: total = adjustPrice(end1, true) * quantity
//
// The client NEVER supplies the price — only the selections. We re-derive every
// number here from the selection identifiers.
// ============================================================================

const { round2 } = require('./money');
const { PricingError } = require('./errors');

// --- Hose price per METRE, keyed by the size string the PWA stores (with ").
const HOSE_UNIT = {
  '1/4"': 12.45,
  '3/8"': 14.50,
  '1/2"': 17.65,
  '5/8"': 19.50,
  '3/4"': 22.00,
  '1"': 28.00,
};

// --- Fitting base prices, per fitting category, keyed by the exact end-size
//     string the PWA stores (e.g. '1/4" - 19'). JIC and ORFS share some size
//     strings with DIFFERENT prices, so the category (derived from the shape
//     name) is required to disambiguate.
const BSP_FITTING = {
  '1/8" - 28': 6.10,
  '1/4" - 19': 7.28,
  '3/8" - 19': 11.18,
  '1/2" - 14': 14.25,
  '3/4" - 14': 16.25,
  '1" - 11': 18.48,
};
const JIC_FITTING = {
  '7/16" - 20': 7.00,
  '9/16" - 18': 8.90,
  '3/4" - 16': 9.10,
  '7/8" - 14': 11.50,
  '1-1/16" - 12': 13.50,
  '1-3/16" - 12': 16.75,
};
const METRIC_FITTING = {
  'M12 - 1.5': 7.50,
  'M14 - 1.5': 8.40,
  'M16 - 1.5': 8.60,
  'M18 - 1.5': 10.50,
  'M22 - 1.5': 14.65,
  'M26 - 1.5': 18.50,
  'M30 - 2': 22.50,
  'M36 - 2': 28.50,
};
const ORFS_FITTING = {
  '9/16" - 18': 7.70,
  '11/16" - 16': 8.85,
  '13/16" - 16': 10.25,
  '1" - 14': 16.95,
  '1-3/16" - 12': 24.50,
};
// SAE (Code 61 / Code 62) prices are plain numbers and are NOT discounted in
// order-fitting mode (the PWA passes them through without adjustPrice).
const SAE_FITTING = {
  '3/4"': 60,
  '1"': 70,
};

// --- Hose protection multipliers (applied to the base hose price).
const PROTECTION_MULTIPLIERS = {
  'Nylon Hose Sleeve': 1.30,
  'Plastic Spiral Cover': 1.40,
  'Metal Spiral Wrap': 1.50,
  'NOT REQUIRED': 1.0,
};

const PRESSURE_TEST_PER_HOSE = 10;

/**
 * Resolve the fitting category from the shape name the PWA stores.
 * Shape names are prefixed with the category: 'BSP ...', 'JIC ...',
 * 'METRIC LIGHT ...', 'ORFS ...', or contain 'SAE Flange'.
 */
function categoryFromShape(shape) {
  const s = String(shape || '').toUpperCase();
  if (s.includes('BSP')) return 'BSP';
  if (s.includes('JIC')) return 'JIC';
  if (s.includes('METRIC')) return 'METRIC';
  if (s.includes('ORFS')) return 'ORFS';
  if (s.includes('SAE')) return 'SAE';
  return null;
}

/** adjustPrice(basePrice, isOrderFittingMode): 20% off in fitting mode, 2dp. */
function adjustFittingPrice(base, isOrderFittingMode) {
  const price = parseFloat(base);
  // Matches PWA: (price * 0.8).toFixed(2) vs price.toFixed(2)
  return parseFloat((isOrderFittingMode ? price * 0.8 : price).toFixed(2));
}

/**
 * Look up + adjust a single end fitting price from its shape + size.
 * SAE prices are passed through without the order-fitting discount, mirroring
 * the PWA (SAEFittings passes the raw number).
 */
function fittingCost(shape, size, isOrderFittingMode) {
  if (!shape || !size) return 0;
  const category = categoryFromShape(shape);
  if (!category) {
    throw new PricingError(`hose360: unrecognised fitting shape "${shape}"`);
  }
  const table = {
    BSP: BSP_FITTING,
    JIC: JIC_FITTING,
    METRIC: METRIC_FITTING,
    ORFS: ORFS_FITTING,
    SAE: SAE_FITTING,
  }[category];

  const base = table[size];
  if (base === undefined) {
    throw new PricingError(`hose360: unknown ${category} fitting size "${size}"`);
  }
  if (category === 'SAE') {
    return Number(base); // no adjustPrice for SAE
  }
  return adjustFittingPrice(base, isOrderFittingMode);
}

/** Sum cut lengths (mm) into metres, matching getTotalLength(). */
function totalLengthMetres(cutLengths) {
  if (!Array.isArray(cutLengths)) return 0;
  return cutLengths.reduce((sum, cut) => {
    if (!cut || cut.length === undefined || cut.length === null || cut.length === '') return sum;
    const mm = parseFloat(cut.length);
    return Number.isFinite(mm) ? sum + mm / 1000 : sum;
  }, 0);
}

function hoseUnitPrice(selectedHose) {
  const size = selectedHose && selectedHose.size;
  if (!size) return { unit: 0, size: null };
  const unit = HOSE_UNIT[size];
  if (unit === undefined) {
    throw new PricingError(`hose360: unknown hose size "${size}"`);
  }
  return { unit, size };
}

/**
 * Price one HOSE360 / PWA line from its selections (orderConfig).
 * Returns { amount, breakdown, swellProductIds }.
 */
function priceHose360Line(item) {
  const cfg = (item && item.orderConfig) || {};
  const {
    selectedHose,
    end1Shape,
    end1Size,
    end2Shape,
    end2Size,
    cutLengths,
    selectedProtection,
    selectedPressure,
    quantity,
    isOrderFittingMode,
  } = cfg;

  const qty = Math.max(1, parseInt(quantity, 10) || 1);

  // ---- Order-fitting mode: just fittings, priced per quantity. ----
  if (isOrderFittingMode) {
    const end1 = fittingCost(end1Shape, end1Size, true);
    const total = end1 * qty;
    return {
      amount: round2(total),
      breakdown: { mode: 'order-fitting', end1, quantity: qty },
      swellProductIds: [],
    };
  }

  // ---- Full custom-assembly mode. ----
  const length = totalLengthMetres(cutLengths);
  const { unit } = hoseUnitPrice(selectedHose);
  const baseHosePrice = length * unit;

  // End fittings are charged PER HOSE — i.e. multiplied by quantity. This
  // mirrors the PWA (CutLengthsScreen.js: totalEnd1Price = end1Price * qty),
  // and applies to SAE fittings too (they skip only the order-fitting discount).
  const end1 = fittingCost(end1Shape, end1Size, false) * qty;
  const end2 = end2Shape ? fittingCost(end2Shape, end2Size, false) * qty : 0;

  // The PWA's "cutLengthPrice" is the whole assembly subtotal: base hose PLUS
  // both end fittings (already × qty). Hose protection is a percentage uplift on
  // THAT subtotal, not on the bare hose price
  // (HoseProtectionScreen.js: protectionCost = cutLengthPrice * (multiplier - 1)).
  const assemblySubtotal = baseHosePrice + end1 + end2;

  let protection = 0;
  if (selectedProtection && selectedProtection !== 'NOT REQUIRED') {
    const mult = PROTECTION_MULTIPLIERS[selectedProtection];
    if (mult === undefined) {
      throw new PricingError(`hose360: unknown protection "${selectedProtection}"`);
    }
    protection = assemblySubtotal * (mult - 1);
  }

  let pressureTest = 0;
  if (selectedPressure && selectedPressure !== 'Not Required') {
    pressureTest = PRESSURE_TEST_PER_HOSE * qty;
  }

  const total = baseHosePrice + end1 + end2 + protection + pressureTest;

  return {
    amount: round2(total),
    breakdown: {
      mode: 'assembly',
      totalLengthM: length,
      hoseUnit: unit,
      baseHosePrice: round2(baseHosePrice),
      end1,
      end2,
      assemblySubtotal: round2(assemblySubtotal),
      protection: round2(protection),
      pressureTest,
      quantity: qty,
    },
    // Hose assemblies are made-to-order (not tracked Swell stock items).
    swellProductIds: [],
  };
}

module.exports = {
  priceHose360Line,
  // exported for unit tests / parity checks
  _internals: { fittingCost, totalLengthMetres, categoryFromShape, adjustFittingPrice, HOSE_UNIT },
};
