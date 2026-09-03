// lib/pricing/website.js
// ============================================================================
// WEBSITE (Swell catalog) products — SERVER-SIDE AUTHORITATIVE PRICING
// ============================================================================
// The price and stock come from Swell, the source of truth — never from the
// client. The client sends only { productId, variantId?, quantity }.
// ============================================================================

const swell = require('swell-node');
const { round2 } = require('./money');
const { PricingError } = require('./errors');

let initialised = false;
function ensureSwell() {
  if (initialised) return;
  const storeId = process.env.SWELL_STORE_ID;
  const secret = process.env.SWELL_SECRET_KEY;
  if (!storeId || !secret) {
    throw new PricingError('website: Swell credentials not configured');
  }
  swell.init(storeId, secret);
  initialised = true;
}

// Steel Tubes category tree, verified live against Swell 2026-09-02:
//   Steel Tubes (63419ba240bb8900127af720)
//   +- Stainless Steel (6341e79a302337001338ddd5)
//   |  +- FPG-SSTM (634c0c10cf682a00131fe1f8)
//   |  +- FPG-SSTI (634c0bee0952f80012a568ca)
//   +- Carbon Steel (6341e76e3561da0012b689d6)
//      +- FPG-CSTM (634c0bc820bec20012b2bb01)
//      +- FPG-CSTI (634c0ba595e16400126463b2)
// Only the four leaf categories hold products today, but the two mid-level
// ids are included too so a product added directly under Carbon Steel or
// Stainless Steel (without a further leaf) still matches. IDs are immutable
// in Swell even if a category is renamed, unlike slugs — safer to hardcode.
const STEEL_TUBES_CATEGORY_IDS = new Set([
  '6341e79a302337001338ddd5', // Stainless Steel
  '634c0c10cf682a00131fe1f8', // FPG-SSTM
  '634c0bee0952f80012a568ca', // FPG-SSTI
  '6341e76e3561da0012b689d6', // Carbon Steel
  '634c0bc820bec20012b2bb01', // FPG-CSTM
  '634c0ba595e16400126463b2', // FPG-CSTI
]);

function isSteelTubesProduct(product) {
  const categoryIds = (product.category_index && product.category_index.id) || [];
  return categoryIds.some((id) => STEEL_TUBES_CATEGORY_IDS.has(id));
}

/**
 * Resolve the authoritative unit price for a product (optionally a variant).
 * Swell variant pricing: a variant may carry its own `price`, otherwise it
 * falls back to the product price.
 */
function resolveUnitPrice(product, variantId) {
  if (variantId && Array.isArray(product.variants && product.variants.results)) {
    const variant = product.variants.results.find((v) => v.id === variantId);
    if (!variant) throw new PricingError(`website: unknown variant "${variantId}"`);
    if (variant.price !== undefined && variant.price !== null) return Number(variant.price);
  }
  if (product.price === undefined || product.price === null) {
    throw new PricingError(`website: product "${product.id}" has no price`);
  }
  return Number(product.price);
}

/**
 * Price one website line. Returns { amount, unitPrice, quantity, name,
 * swellProductId, stock, inventory }.
 */
async function priceWebsiteLine(item) {
  ensureSwell();

  const productId = item && item.productId;
  if (!productId) throw new PricingError('website: missing productId');

  const qty = Math.max(1, parseInt(item.quantity, 10) || 1);

  let product;
  try {
    product = await swell.get('/products/{id}', { id: productId, expand: ['variants'] });
  } catch (err) {
    throw new PricingError(`website: failed to load product "${productId}": ${err.message}`);
  }
  if (!product || product.id === undefined) {
    throw new PricingError(`website: product not found "${productId}"`);
  }

  const unitPrice = resolveUnitPrice(product, item.variantId);

  // Primary product image (Swell already returned it on this same fetch — no
  // extra API call). Threaded into the quote so the confirmation emails can
  // show the product thumbnail without trusting a client-supplied URL.
  const image =
    (product.images && product.images[0] && product.images[0].file && product.images[0].file.url) ||
    '';

  // Defense-in-depth stock re-validation (same trust boundary the inventory
  // decrement relies on). stock_level null => untracked, allow.
  const stock = product.stock_level;
  if (stock !== null && stock !== undefined && Number(stock) < qty) {
    throw new PricingError(
      `website: insufficient stock for "${product.name || productId}" (have ${stock}, need ${qty})`,
      { productId, requested: qty, available: stock }
    );
  }

  return {
    amount: round2(unitPrice * qty),
    unitPrice: round2(unitPrice),
    quantity: qty,
    name: product.name || productId,
    swellProductId: productId,
    variantId: item.variantId || null,
    stock: stock ?? null,
    image,
    // Steel Tubes shipping rule (see STEEL_TUBES_CATEGORY_IDS above). Per-line:
    // a cart LINE represents one continuous physical length being cut and
    // shipped as a single piece, so qty > 1 on ONE line means that piece is
    // longer than 1m and needs special freight — not the same thing as the
    // customer having two separate 1m lines of the same tube (two ordinary
    // parcels, standard shipping, even though the cart total for that product
    // is 2). Deliberately does NOT sum quantity across lines.
    isSteelTubesLineOverLength: isSteelTubesProduct(product) && qty > 1,
  };
}

module.exports = { priceWebsiteLine };
