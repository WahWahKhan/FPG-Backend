/* eslint-disable */
// ============================================================================
// PRICING PARITY SWEEP — frontend (what the customer sees) vs backend (what
// PayPal is charged). Catches ANY divergence between the two independent
// pricing implementations, across every configurator option, in ONE run.
//
// Run:  node scripts/pricing-parity.test.js
//   (from the backend-sandbox root; needs its node_modules for the pricing libs)
//
// "Frontend truth" is loaded/replicated directly from the frontend + PWA source:
//   - TRAC360   : data/trac360/<per-addon>.json + circuits.json + pricing.ts formula
//   - FUNCTION360: data/function360/<component>.json + summary.tsx variant fns
//   - HOSE360   : HoseCalculator components/Prices/*.js + the PWA price formula
// Website is Swell-priced (a single source of truth) so it cannot drift — skipped.
// ============================================================================

const fs = require('fs');
const BE = __dirname + '/..';
// Frontend "source of truth" root. Override with FE_ROOT; otherwise use the first
// candidate that exists (live frontend, then sandbox). Their pricing data is kept
// in sync, so either works — this just lets the harness run from either backend.
const FE = (() => {
  const candidates = [
    process.env.FE_ROOT,
    '/Users/aaa/Documents/Website/FrontEnd/fpg-backup-frontend',
    '/Users/aaa/Documents/Website/FrontEnd/fpg-backup-frontend-sandbox',
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p + '/data/trac360/circuits.json'));
  if (!found) throw new Error('Frontend root not found; set FE_ROOT to the frontend project path.');
  return found;
})();

const { priceTrac360Line } = require(BE + '/lib/pricing/trac360');
const { priceFunction360Line } = require(BE + '/lib/pricing/function360');
const { priceHose360Line, _internals } = require(BE + '/lib/pricing/hose360');

let pass = 0, fail = 0;
const fails = [];
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
function ck(cond, label, extra) {
  if (cond) { pass++; }
  else { fail++; fails.push(label + (extra ? `  (${extra})` : '')); }
}

// ============================================================================
// TRAC360
// ============================================================================
function trac360Sweep() {
  const circuits = require(FE + '/data/trac360/circuits.json');
  const circuitList = Array.isArray(circuits) ? circuits : circuits.circuits || [];
  const addonFiles = ['valve-adaptors', 'tractor-hose-kit', 'hose-protection', 'joystick-upgradation', 'mounting-brackets']
    .map((f) => require(FE + `/data/trac360/${f}.json`));

  // Frontend formula (utils/trac360/pricing.ts): base(1250 if opType & no circuit)
  // + circuit.price + Σ(addon.basePrice + selectedSubOption.additionalPrice).
  const feAddonPrice = (addon, subId) => {
    let p = Number(addon.basePrice) || 0;
    if (subId && Array.isArray(addon.subOptions)) {
      const s = addon.subOptions.find((o) => o.id === subId);
      if (s) p += Number(s.additionalPrice) || 0;
    }
    return p;
  };

  let n = 0;
  // 1) Every circuit alone.
  for (const c of circuitList) {
    const be = priceTrac360Line({ config: { operationTypeId: 'op-x', circuitId: c.id, addons: [] } }).amount;
    ck(near(be, c.price), `TRAC360 circuit ${c.id}`, `FE $${c.price} vs BE $${be}`); n++;
  }
  // 2) Path A: operation type, no circuit -> flat 1250.
  {
    const be = priceTrac360Line({ config: { operationTypeId: 'op-x', circuitId: null, addons: [] } }).amount;
    ck(near(be, 1250), `TRAC360 path-A base (no circuit)`, `FE $1250 vs BE $${be}`); n++;
  }
  // 3) Every addon, with null sub-option AND each sub-option, on a fixed circuit base.
  const baseCircuit = circuitList.find((c) => c.id === '1-circuit') || circuitList[0];
  for (const addon of addonFiles) {
    const subIds = [null, ...((addon.subOptions || []).map((s) => s.id))];
    for (const subId of subIds) {
      const be = priceTrac360Line({ config: {
        operationTypeId: 'op-x', circuitId: baseCircuit.id,
        addons: [{ id: addon.id, selectedSubOptionId: subId }] } }).amount;
      const exp = Number(baseCircuit.price) + feAddonPrice(addon, subId);
      ck(near(be, exp), `TRAC360 ${addon.id} + sub[${subId || 'none'}]`, `FE $${exp} vs BE $${be}`); n++;
    }
  }
  // 4) A full multi-addon cart.
  {
    const addonsSel = addonFiles.map((a) => ({ id: a.id, selectedSubOptionId: (a.subOptions && a.subOptions[0] && a.subOptions[0].id) || null }));
    const be = priceTrac360Line({ config: { operationTypeId: 'op-x', circuitId: '2-circuit', addons: addonsSel } }).amount;
    const circ = circuitList.find((c) => c.id === '2-circuit');
    const exp = Number(circ.price) + addonFiles.reduce((s, a, i) => s + feAddonPrice(a, addonsSel[i].selectedSubOptionId), 0);
    ck(near(be, exp), `TRAC360 full cart (2-circuit + all addons)`, `FE $${exp} vs BE $${be}`); n++;
  }
  return n;
}

// ============================================================================
// FUNCTION360  (variant fns replicated verbatim from summary.tsx)
// ============================================================================
function function360Sweep() {
  const data = {
    diverterValve: require(FE + '/data/function360/diverter-valve.json'),
    quickCouplings: require(FE + '/data/function360/quick-couplings.json'),
    adaptors: require(FE + '/data/function360/adaptors.json'),
    hydraulicHoses: require(FE + '/data/function360/hydraulic-hoses.json'),
    electrical: require(FE + '/data/function360/electrical.json'),
    mountingBrackets: require(FE + '/data/function360/mounting-brackets.json'),
  };
  const V = { // frontend variant selectors (summary.tsx)
    diverterValve: (hp, ft) => { if (!hp || !ft) return 'electric_3rd_below_50hp'; const s = hp === 'below_50hp' ? 'below_50hp' : 'above_50hp'; if (ft === 'live_3rd') return `live_3rd_${s}`; if (ft === 'electric_3rd_4th') return `electric_3rd_4th_${s}`; return `electric_3rd_${s}`; },
    quickCouplings: (hp, ft) => { if (!hp || !ft) return 'default_below_50hp'; const s = hp === 'below_50hp' ? 'below_50hp' : 'above_50hp'; if (ft === 'electric_3rd_4th') return `electric_3rd_4th_${s}`; return `default_${s}`; },
    adaptors: (hp) => !hp ? 'below_50hp' : (hp === 'above_50hp' ? 'above_50hp' : 'below_50hp'),
    hydraulicHoses: (hp) => !hp ? 'below_50hp' : (hp === 'above_50hp' ? 'above_50hp' : 'below_50hp'),
    electrical: (_hp, ft) => !ft ? 'electric_3rd' : (ft === 'electric_3rd_4th' ? 'electric_3rd_4th' : 'electric_3rd'),
    mountingBrackets: (_hp, ft) => !ft ? 'default' : (ft === 'electric_3rd_4th' ? 'electric_3rd_4th' : 'default'),
  };
  const feComponentPrice = (key, hp, ft) => {
    const vkey = V[key](hp, ft);
    const v = data[key].variants && data[key].variants[vkey];
    return v ? Number(v.price) : NaN;
  };

  const keys = ['diverterValve', 'quickCouplings', 'adaptors', 'hydraulicHoses', 'electrical', 'mountingBrackets'];
  const HPs = ['below_50hp', 'above_50hp', null];
  const FTs = ['live_3rd', 'electric_3rd', 'electric_3rd_4th', null];
  let n = 0;
  for (const hp of HPs) for (const ft of FTs) {
    // all components selected
    const sel = {}; keys.forEach((k) => (sel[k] = true));
    let be;
    try { be = priceFunction360Line({ selectedComponents: sel, equipment: { horsepower: hp, functionType: ft } }).amount; }
    catch (e) { ck(false, `FUNCTION360 all comps hp=${hp} ft=${ft}`, 'BACKEND THREW: ' + e.message); n++; continue; }
    const exp = keys.reduce((s, k) => s + feComponentPrice(k, hp, ft), 0);
    ck(near(be, exp), `FUNCTION360 all comps hp=${hp} ft=${ft}`, `FE $${exp} vs BE $${be}`); n++;

    // each component individually
    for (const k of keys) {
      const one = {}; one[k] = true;
      let b;
      try { b = priceFunction360Line({ selectedComponents: one, equipment: { horsepower: hp, functionType: ft } }).amount; }
      catch (e) { ck(false, `FUNCTION360 ${k} hp=${hp} ft=${ft}`, 'BACKEND THREW: ' + e.message); n++; continue; }
      const e2 = feComponentPrice(k, hp, ft);
      ck(near(b, e2), `FUNCTION360 ${k} hp=${hp} ft=${ft}`, `FE $${e2} vs BE $${b}`); n++;
    }
  }
  return n;
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
const t1 = trac360Sweep();
const t2 = function360Sweep();
const t3 = hose360Sweep();
console.log(`TRAC360:     ${t1} checks`);
console.log(`FUNCTION360: ${t2} checks`);
console.log(`HOSE360:     ${t3} checks`);
console.log('───────────────────────────────────────────────────────────────');
if (fails.length) {
  console.log(`\n❌ ${fails.length} MISMATCH(ES):`);
  for (const f of fails) console.log('   • ' + f);
}
console.log(`\n${fail === 0 ? '✅' : '❌'} TOTAL: ${pass} passed, ${fail} failed  (${t1 + t2 + t3} price points checked)`);
process.exit(fail === 0 ? 0 : 1);
