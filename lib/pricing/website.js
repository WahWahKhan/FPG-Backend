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
  };
}

module.exports = { priceWebsiteLine };
