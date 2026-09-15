/* eslint-disable */
// ============================================================================
// TUBE360 pricing + validation tests.
//
// Run from the backend-sandbox root:   npm run test:tube360
//   (or: node scripts/tube360-pricing.test.js)
//
// Uses a STUBBED Swell price so results are deterministic and no network call
// is made. Set LIVE=1 to additionally price one tube against the real Swell
// price (read-only GET, needs .env.local Swell credentials).
//
// Expected values assume the PLACEHOLDER rates.json shipped with the plan.
// If the owner changes rates.json, update the EXPECTED amounts below in the
// same change.
// ============================================================================

const path = require('path');
const BE = path.join(__dirname, '..');
const { priceTube360Line, validateTube360Spec } = require(BE + '/lib/pricing/tube360');
const { PricingError } = require(BE + '/lib/pricing/errors');

// Stub Swell prices (per metre) - copied from Swell 2026-09-12.
const STUB_PRICES = {
  '6379ceeab93a6a0012f10173': 9.25,  // FPG-CSTM-12-15
  '6379d304a5fd7a00120a63e4': 20.50, // FPG-SSTM-18-20
  '6379d24bef180f00139601c4': 22.95, // FPG-SSTI-342000
};
const deps = {
  getUnitPrice: async (id) => {
    if (!(id in STUB_PRICES)) throw new Error(`no stub price for ${id}`);
    return STUB_PRICES[id];
  },
};

let pass = 0;
let fail = 0;
const failures = [];
function check(cond, label, extra) {
  if (cond) pass++;
  else { fail++; failures.push(label + (extra !== undefined ? `  (got ${JSON.stringify(extra)})` : '')); }
}

async function expectAmount(label, spec, expected, extraChecks) {
  try {
    const res = await priceTube360Line({ kind: 'tube360', cartId: 1, spec }, deps);
    check(res.amount === expected, `${label}: amount ${expected}`, res.amount);
    check(Array.isArray(res.swellProductIds) && res.swellProductIds.length === 0, `${label}: swellProductIds empty`, res.swellProductIds);
    if (extraChecks) extraChecks(res);
  } catch (e) {
    check(false, `${label}: threw unexpectedly`, e.message);
  }
}

async function expectReject(label, spec, messagePart) {
  try {
    await priceTube360Line({ kind: 'tube360', cartId: 1, spec }, deps);
    check(false, `${label}: should have been rejected`);
  } catch (e) {
    check(e instanceof PricingError, `${label}: PricingError`, e.name);
    if (messagePart) check(String(e.message).includes(messagePart), `${label}: message mentions "${messagePart}"`, e.message);
  }
}

const base = {
  catalogId: 'FPG-CSTM-12-15',
  endA: 'flare',
  endB: 'ring',
  totalLengthMm: 3000,
  quantity: 2,
  bendRadiusMm: 24,
  sectionsMm: [800, 700, 700, 800],
  anglesDeg: [90, 45, 90],
};

(async () => {
  // ---- Happy paths ----------------------------------------------------------
  // 1. Worked example from the plan:
  //    material 9.25 x 3.000 = 27.75 ; bending 3 x 6 x 1.0 = 18.00 ;
  //    ends 8 + 12 = 20.00 ; perTube 65.75 ; x2 = 131.50 ; + setup 25 = 156.50
  await expectAmount('worked example', base, 156.5, (res) => {
    const b = res.breakdown;
    check(b.material.cost === 27.75, 'worked example: material 27.75', b.material.cost);
    check(b.bending.cost === 18, 'worked example: bending 18', b.bending.cost);
    check(b.ends.endA.cost === 8 && b.ends.endB.cost === 12, 'worked example: ends 8 + 12', b.ends);
    check(b.perTube === 65.75, 'worked example: perTube 65.75', b.perTube);
    check(b.setupFee === 25, 'worked example: setup 25', b.setupFee);
    check(b.band === 'small', 'worked example: band small', b.band);
    check(res.isSteelTubesLineOverLength === true, 'worked example: >1000mm triggers freight flag');
    check(res.name === 'TUBE360 Custom Tube', 'worked example: line name');
  });

  // 2. Linear bend pricing (5 bends, flat rate, no complexity multiplier):
  //    material 9.25 x 2 = 18.50 ; bending 5 x 6 = 30.00 ; ends 0 ;
  //    perTube 48.50 ; x1 ; + setup 25 = 73.50
  await expectAmount('5 bends, flat linear rate', {
    ...base, endA: 'none', endB: 'none', totalLengthMm: 2000, quantity: 1,
    sectionsMm: [400, 300, 300, 300, 300, 400], anglesDeg: [90, 90, 90, 90, 90],
  }, 73.5);

  // 3. Straight tube (0 bends -> no setup fee), medium band, ring both ends:
  //    material 20.50 x 1.5 = 30.75 ; ends 15 + 15 (medium ring) ; perTube 60.75 ; x3 = 182.25
  await expectAmount('straight tube, no setup fee', {
    catalogId: 'FPG-SSTM-18-20', endA: 'ring', endB: 'ring', totalLengthMm: 1500, quantity: 3,
    bendRadiusMm: null, sectionsMm: [1500], anglesDeg: [],
  }, 182.25, (res) => {
    check(res.breakdown.setupFee === 0, 'straight tube: setup 0', res.breakdown.setupFee);
    check(res.breakdown.band === 'medium', 'straight tube: band medium', res.breakdown.band);
    check(res.breakdown.spec.bendRadiusMm === null, 'straight tube: radius normalised to null');
  });

  // 4. Medium band, 7 bends, flat linear rate, imperial 3/4":
  //    material 22.95 x 5.000 = 114.75 ; bending 7 x 6 = 42.00 ; ends 10 + 0 ;
  //    perTube 166.75 ; x1 ; + setup 25 = 191.75
  await expectAmount('7 bends medium band', {
    catalogId: 'FPG-SSTI-342000', endA: 'flare', endB: 'none', totalLengthMm: 5000, quantity: 1,
    bendRadiusMm: 39, sectionsMm: [600, 600, 600, 800, 800, 600, 500, 500],
    anglesDeg: [90, 45, 30, 90, 15.5, 60, 120],
  }, 191.75);

  // 5. Freight threshold: exactly 1000 -> no flag ; 1001 -> flag
  await expectAmount('1000mm exactly', {
    ...base, totalLengthMm: 1000, sectionsMm: [250, 250, 250, 250],
  }, round(9.25 * 1 + 18 + 20) * 2 + 25, (res) => {
    check(res.isSteelTubesLineOverLength === false, '1000mm: no freight flag');
  });
  await expectAmount('1001mm', {
    ...base, totalLengthMm: 1001, sectionsMm: [251, 250, 250, 250],
  }, round(round(9.25 * 1.001) + 18 + 20) * 2 + 25, (res) => {
    check(res.isSteelTubesLineOverLength === true, '1001mm: freight flag');
  });

  // ---- Rejections (fail closed) ---------------------------------------------
  await expectReject('unknown tube', { ...base, catalogId: 'NOPE' }, 'unknown tube');
  await expectReject('flare on 1/4"', {
    catalogId: 'FPG-SSTI-1415', endA: 'flare', endB: 'none', totalLengthMm: 500, quantity: 1,
    bendRadiusMm: null, sectionsMm: [500], anglesDeg: [],
  }, 'not available');
  await expectReject('bad end type', { ...base, endB: 'weld' }, 'not available');
  await expectReject('length 6001', { ...base, totalLengthMm: 6001, sectionsMm: [1501, 1500, 1500, 1500] }, 'total length');
  await expectReject('length 99', { ...base, totalLengthMm: 99 }, 'total length');
  await expectReject('length not integer', { ...base, totalLengthMm: 3000.5 }, 'total length');
  await expectReject('qty 0', { ...base, quantity: 0 }, 'quantity');
  await expectReject('qty 101', { ...base, quantity: 101 }, 'quantity');
  await expectReject('sum mismatch', { ...base, sectionsMm: [800, 700, 700, 799] }, 'add up to');
  await expectReject('section below min', { ...base, sectionsMm: [49, 1151, 1000, 800] }, 'section 1');
  await expectReject('sections/angles count mismatch', { ...base, anglesDeg: [90, 45] }, 'one more section');
  await expectReject('angle 0.5 (< min 1)', { ...base, anglesDeg: [0.5, 45, 90] }, 'bend 1 angle');
  await expectReject('angle 191', { ...base, anglesDeg: [90, 191, 90] }, 'bend 2 angle');
  await expectReject('angle 2 decimals', { ...base, anglesDeg: [90, 45, 90.25] }, 'bend 3 angle');
  await expectReject('radius below fixed value', { ...base, bendRadiusMm: 23 }, 'bend radius');
  await expectReject('radius above fixed value', { ...base, bendRadiusMm: 61 }, 'bend radius');
  await expectReject('radius missing with bends', { ...base, bendRadiusMm: null }, 'bend radius');
  await expectReject('11 bends', {
    ...base, totalLengthMm: 6000, sectionsMm: Array(12).fill(500), anglesDeg: Array(11).fill(90),
  }, 'maximum');
  await expectReject('missing spec', undefined, 'missing');

  // ---- Upload-flow validation (no bend schedule) ----------------------------
  try {
    const { entry } = validateTube360Spec(
      { catalogId: 'FPG-CSTM-12-15', endA: 'none', endB: 'ring', totalLengthMm: 2500, quantity: 4 },
      { requireBends: false }
    );
    check(entry.id === 'FPG-CSTM-12-15', 'upload-flow spec validates without bends');
  } catch (e) {
    check(false, 'upload-flow spec validates without bends', e.message);
  }

  // ---- Optional live Swell check --------------------------------------------
  if (process.env.LIVE === '1') {
    require('dotenv').config({ path: BE + '/.env.local' });
    const live = await priceTube360Line({ kind: 'tube360', cartId: 1, spec: base });
    console.log(`LIVE: FPG-CSTM-12-15 Swell price/m = ${live.breakdown.material.pricePerMetre}, line amount = ${live.amount}`);
    check(live.amount > 0, 'LIVE: priced against Swell');
  }

  console.log(`\nTUBE360 pricing tests: ${pass} passed, ${fail} failed`);
  if (fail) {
    failures.forEach((f) => console.log('  FAIL ' + f));
    process.exit(1);
  }
})();

function round(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
