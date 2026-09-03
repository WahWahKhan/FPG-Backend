// lib/pricing/index.js
// ============================================================================
// priceCart() — the single server-side price authority for checkout.
// ============================================================================
// Takes the price-less order items from the browser (identifiers + configurator
// selections only) and recomputes every line from trusted data (Swell + the
// server-held rule tables ported from the configurators). Adds shipping + GST
// using the same formula the site has always displayed, so the server total
// matches the customer's on-screen total to the cent while being impossible to
// tamper with.
//
// Shipping/GST mirror utils/cart-helpers.ts::calculateCartTotals:
//   shipping = 12.85 (flat), or $80 for the whole order if any ONE Steel
//              Tubes cart line (see website.js) has qty > 1 — i.e. a single
//              continuous length over 1m. Two separate qty-1 lines of the
//              same tube do NOT trigger it; that's two 1m pieces, not one
//              longer piece. Per-line, deliberately not aggregated across
//              lines of the same product.
//   gst      = (subtotal + shipping) * 0.10
//   total    = subtotal + shipping + gst
// ============================================================================

const { round2, toAmountString } = require('./money');
const { PricingError } = require('./errors');
const { priceWebsiteLine } = require('./website');
const { priceFunction360Line } = require('./function360');
const { priceTrac360Line } = require('./trac360');
const { priceHose360Line } = require('./hose360');

const FLAT_SHIPPING = 12.85;
const STEEL_TUBES_SHIPPING = 80;
const GST_RATE = 0.10;

/**
 * @param {Array} items - ServerOrderItem[] from the frontend contract
 * @returns {Promise<{currency, lines, subtotal, shipping, gst, total, amountValue}>}
 * @throws {PricingError} if any line cannot be priced (fail closed — no order).
 */
async function priceCart(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new PricingError('priceCart: empty cart');
  }

  const lines = [];
  let subtotal = 0;

  for (const item of items) {
    let priced;
    switch (item && item.kind) {
      case 'website':
        priced = await priceWebsiteLine(item);
        break;
      case 'function360':
        priced = priceFunction360Line(item);
        break;
      case 'trac360':
        priced = priceTrac360Line(item);
        break;
      case 'pwa':
        priced = priceHose360Line(item);
        break;
      default:
        throw new PricingError(`priceCart: unknown item kind "${item && item.kind}"`);
    }

    const line = {
      kind: item.kind,
      cartId: item.cartId ?? null,
      amount: priced.amount,
      name: priced.name || null,
      swellProductIds: priced.swellProductIds || (priced.swellProductId ? [priced.swellProductId] : []),
      unitPrice: priced.unitPrice ?? null,
      quantity: priced.quantity ?? 1,
      breakdown: priced.breakdown || null,
      image: priced.image || null,
      isSteelTubesLineOverLength: priced.isSteelTubesLineOverLength === true,
    };
    subtotal += line.amount;
    lines.push(line);
  }

  // Steel Tubes shipping rule: switches shipping for the WHOLE order to a
  // flat $80 if any ONE cart line is a Steel Tubes product ordered at qty > 1
  // (see website.js) — a single continuous length over 1m needing special
  // freight. Shipping itself is a single order-level charge, not per-line, so
  // once triggered it applies to everything in the order.
  const steelTubesShippingTriggered = lines.some((line) => line.isSteelTubesLineOverLength);
  const shipping = steelTubesShippingTriggered ? STEEL_TUBES_SHIPPING : FLAT_SHIPPING;
  const gst = (subtotal + shipping) * GST_RATE;
  const rawTotal = subtotal + shipping + gst;

  // The charged amount is toFixed(2) of the raw float total — identical to the
  // legacy client (`totals.total.toFixed(2)`). Derive the displayed `total` from
  // that SAME string so the number the customer sees always equals the number
  // PayPal is charged (no half-up vs toFixed 1-cent divergence).
  const amountValue = toAmountString(rawTotal);

  return {
    currency: 'AUD',
    lines,
    subtotal: round2(subtotal),
    shipping: round2(shipping),
    gst: round2(gst),
    total: Number(amountValue),
    // The exact string charged to PayPal / reconciled at capture.
    amountValue,
  };
}

module.exports = { priceCart, PricingError };
