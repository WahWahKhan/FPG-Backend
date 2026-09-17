/* eslint-disable */
// ============================================================================
// PRICING PARITY SWEEP — frontend (what the customer sees) vs backend (what
// PayPal is charged). Catches ANY divergence between two INDEPENDENT pricing
// implementations of the same product, in ONE run.
//
// Run:  node scripts/pricing-parity.test.js
//   (from the backend-sandbox root; needs its node_modules for the pricing libs)
//
// "Frontend truth" is loaded/replicated directly from the frontend + PWA source:
//   - HOSE360   : HoseCalculator components/Prices/*.js + the PWA price formula
//     (hardcoded inline below, not loaded from a frontend file — HOSE360's
//     migration is separately deferred by the owner, so this pair genuinely
//     still has two independent implementations that CAN drift).
// Website is Swell-priced (a single source of truth) so it cannot drift — skipped.
//
// TRAC360 and FUNCTION360 sweeps were RETIRED 2026-09-17 (Plan 04 / Trac360-
// Function360 pricing consolidation): the frontend no longer holds ANY copy of
// their pricing or catalogue data (deleted `data/trac360/*.json` and
// `data/function360/*.json` once both apps' configurator pages were rewired
// to fetch from the backend's own `/api/{trac360,function360}/options` and
// `/price` endpoints). There is now only ONE implementation for each, so the
// class of drift these two sweeps existed to catch is structurally
// impossible - a parity check against a frontend copy that no longer exists
// would be meaningless, not a regression indicator. See
// TUBE360_PLAN/reports/05_TRAC360_FUNCTION360_PRICING_REPORT.md and
// TUBE360_PLAN/reports/05_PAYPAL_PREVIEW_TESTING_REPORT.md (which caught this
// script silently throwing post-migration, via audit) for the full history.
// If either product ever regains a second, independently-maintained pricing
// copy, add its sweep back using this HOSE360 sweep as the template.
// ============================================================================

const BE = __dirname + '/..';
const { priceHose360Line, _internals } = require(BE + '/lib/pricing/hose360');

let pass = 0, fail = 0;
const fails = [];
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
function ck(cond, label, extra) {
  if (cond) { pass++; }
  else { fail++; fails.push(label + (extra ? `  (${extra})` : '')); }
}

// ============================================================================
// HOSE360  (PWA tables from HoseCalculator/components/Prices + PWA formula)
// ============================================================================
function hose360Sweep() {
  // Frontend truth tables (diameter-keyed, as in components/Prices/*.js).
  const FE_HOSE = { '1/4': 12.45, '3/8': 14.50, '1/2': 17.65, '5/8': 19.50, '3/4': 22.00, '1': 28.00 };
  const FE_BSP = { '1/8': 6.10, '1/4': 7.28, '3/8': 11.18, '1/2': 14.25, '3/4': 16.25, '1': 18.48 };
  const FE_JIC = { '7/16': 7.00, '9/16': 8.90, '3/4': 9.10, '7/8': 11.50, '1-1/16': 13.50, '1-3/16': 16.75 };
  const FE_METRIC = { 'M12': 7.50, 'M14': 8.40, 'M16': 8.60, 'M18': 10.50, 'M22': 14.65, 'M26': 18.50, 'M30': 22.50, 'M36': 28.50 };
  const FE_ORFS = { '9/16': 7.70, '11/16': 8.85, '13/16': 10.25, '1': 16.95, '1-3/16': 24.50 };
  const FE_SAE = { '3/4"': 60, '1"': 70 }; // SAE Code 61 & 62 both, size-keyed (with quote)
  const FE_PROT = { 'Nylon Hose Sleeve': 1.30, 'Plastic Spiral Cover': 1.40, 'Metal Spiral Wrap': 1.50, 'NOT REQUIRED': 1.0 };

  // Backend full-size key -> PWA diameter key.
  const diameterOf = (fullSize) => String(fullSize).split(' - ')[0].replace(/"$/, '');

  // --- (a) Table-value parity: backend fittingCost(shape,size) == PWA table. ---
  const cats = [
    { shape: 'BSP Straight', keys: ['1/8" - 28', '1/4" - 19', '3/8" - 19', '1/2" - 14', '3/4" - 14', '1" - 11'], tbl: FE_BSP },
    { shape: 'JIC Straight', keys: ['7/16" - 20', '9/16" - 18', '3/4" - 16', '7/8" - 14', '1-1/16" - 12', '1-3/16" - 12'], tbl: FE_JIC },
    { shape: 'METRIC LIGHT', keys: ['M12 - 1.5', 'M14 - 1.5', 'M16 - 1.5', 'M18 - 1.5', 'M22 - 1.5', 'M26 - 1.5', 'M30 - 2', 'M36 - 2'], tbl: FE_METRIC },
    { shape: 'ORFS Straight', keys: ['9/16" - 18', '11/16" - 16', '13/16" - 16', '1" - 14', '1-3/16" - 12'], tbl: FE_ORFS },
    { shape: 'SAE Flange 3000psi', keys: ['3/4"', '1"'], tbl: FE_SAE, sae: true },
  ];
  let n = 0;
  for (const c of cats) {
    for (const k of c.keys) {
      const be = _internals.fittingCost(c.shape, k, false);
      const feKey = c.sae ? k : diameterOf(k);
      const fe = c.tbl[feKey];
      ck(near(be, fe), `HOSE360 table ${c.shape} ${k}`, `FE $${fe} vs BE $${be}`); n++;
    }
  }
  // Hose unit table.
  for (const k of Object.keys(FE_HOSE)) {
    const be = _internals.HOSE_UNIT[`${k}"`];
    ck(near(be, FE_HOSE[k]), `HOSE360 hose unit ${k}"`, `FE $${FE_HOSE[k]} vs BE $${be}`); n++;
  }

  // --- (b) Full-formula parity over an enumerated matrix + the 2 real carts. ---
  // Frontend PWA price (screens/CutLengths+HoseProtection+PressureTesting).
  const feFit = (shape, size) => {
    if (!shape || !size) return 0;
    const s = String(shape).toUpperCase();
    if (s.includes('SAE')) return FE_SAE[size];
    const d = diameterOf(size);
    if (s.includes('BSP')) return FE_BSP[d];
    if (s.includes('JIC')) return FE_JIC[d];
    if (s.includes('METRIC')) return FE_METRIC[d];
    if (s.includes('ORFS')) return FE_ORFS[d];
    return undefined;
  };
  const fePrice = (cfg) => {
    const qty = Math.max(1, parseInt(cfg.quantity, 10) || 1);
    const len = (cfg.cutLengths || []).reduce((s, c) => s + (parseFloat(c.length) / 1000 || 0), 0);
    const base = len * FE_HOSE[String(cfg.selectedHose.size).replace(/"$/, '')];
    const end1 = feFit(cfg.end1Shape, cfg.end1Size) * qty;
    const end2 = cfg.end2Shape ? feFit(cfg.end2Shape, cfg.end2Size) * qty : 0;
    const assembly = base + end1 + end2;
    const prot = (!cfg.selectedProtection || cfg.selectedProtection === 'NOT REQUIRED') ? 0 : assembly * (FE_PROT[cfg.selectedProtection] - 1);
    const pt = (!cfg.selectedPressure || cfg.selectedPressure === 'Not Required') ? 0 : 10 * qty;
    return Math.round((base + end1 + end2 + prot + pt) * 100) / 100;
  };

  const configs = [
    // the two real cart lines
    { selectedHose: { size: '5/8"' }, end1Shape: 'BSP Female Straight', end1Size: '3/4" - 14', end2Shape: 'ORFS Female 90°', end2Size: '1-3/16" - 12', quantity: 2, cutLengths: [{ length: '230' }, { length: '640' }], selectedProtection: 'Nylon Hose Sleeve', selectedPressure: 'Not Required' },
    { selectedHose: { size: '1"' }, end1Shape: '90° SAE Flange 3000psi', end1Size: '3/4"', end2Shape: '90° SAE Flange 3000psi', end2Size: '1"', quantity: 2, cutLengths: [{ length: '200' }, { length: '3000' }], selectedProtection: 'Plastic Spiral Cover', selectedPressure: 'Not Required' },
  ];
  // matrix: hose sizes × fitting categories × protections × pressure × qty
  const hoseSizes = ['1/4"', '1/2"', '3/4"', '1"'];
  const fitSamples = [
    ['BSP Straight', '1/2" - 14'], ['JIC Straight', '3/4" - 16'],
    ['METRIC LIGHT', 'M22 - 1.5'], ['ORFS Straight', '1-3/16" - 12'], ['SAE Flange 3000psi', '1"'],
  ];
  const prots = ['NOT REQUIRED', 'Nylon Hose Sleeve', 'Plastic Spiral Cover', 'Metal Spiral Wrap'];
  const pressures = ['Not Required', 'Required'];
  for (const hs of hoseSizes) for (const [e1s, e1z] of fitSamples) for (const prot of prots) for (const pr of pressures) for (const qty of [1, 3]) {
    configs.push({ selectedHose: { size: hs }, end1Shape: e1s, end1Size: e1z, end2Shape: 'BSP Straight', end2Size: '3/4" - 14', quantity: qty, cutLengths: [{ length: '500' }, { length: '750' }], selectedProtection: prot, selectedPressure: pr });
  }

  for (const cfg of configs) {
    let be;
    try { be = priceHose360Line({ orderConfig: cfg }).amount; }
    catch (e) { ck(false, `HOSE360 ${cfg.selectedHose.size}/${cfg.end1Shape}/${cfg.selectedProtection}/${cfg.selectedPressure}/q${cfg.quantity}`, 'BACKEND THREW: ' + e.message); n++; continue; }
    const fe = fePrice(cfg);
    ck(near(be, fe), `HOSE360 ${cfg.selectedHose.size} ${cfg.end1Shape} ${cfg.selectedProtection} PT:${cfg.selectedPressure} q${cfg.quantity}`, `FE $${fe} vs BE $${be}`); n++;
  }
  return n;
}

// ============================================================================
console.log('════════════════════ PRICING PARITY SWEEP ════════════════════');
const t3 = hose360Sweep();
console.log(`HOSE360:     ${t3} checks`);
console.log('───────────────────────────────────────────────────────────────');
if (fails.length) {
  console.log(`\n❌ ${fails.length} MISMATCH(ES):`);
  for (const f of fails) console.log('   • ' + f);
}
console.log(`\n${fail === 0 ? '✅' : '❌'} TOTAL: ${pass} passed, ${fail} failed  (${t3} price points checked)`);
process.exit(fail === 0 ? 0 : 1);
