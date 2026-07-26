// pages/api/paypal/create-order.js
// ============================================================================
// SERVER-AUTHORITY create-order (price tampering fix).
// ============================================================================
// The browser sends ONLY price-less identifiers/configurator selections. This
// endpoint recomputes every price from trusted data (Swell + server-held rule
// tables), creates the PayPal order for ITS OWN total, and persists that total
// as a "quote" in Upstash Redis keyed by the PayPal orderID. capture-order then
// reconciles PayPal's amount against this quote before banking anything.
//
// The legacy behaviour (trusting a client `amount`) has been REMOVED — that was
// the vulnerability. Requests must use the new { items } contract.
// ============================================================================

import fetch from 'node-fetch';
import { priceCart, PricingError } from '../../../lib/pricing';
import { resolveDevPricing } from '../../../lib/pricing/dev-pricing';
import * as quoteStore from '../../../lib/quote-store';

// --- PayPal environment selection (unchanged) ---
const isVercelPreview = process.env.VERCEL_ENV === 'preview';
const forceSandbox = process.env.PAYPAL_MODE === 'sandbox';
const forceProduction = process.env.PAYPAL_MODE === 'production';

const USE_SANDBOX = forceProduction ? false : (forceSandbox || isVercelPreview || process.env.NODE_ENV !== 'production');
const PAYPAL_CLIENT_ID = USE_SANDBOX ? process.env.SANDBOX_CLIENT_ID : process.env.PRODUCTION_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = USE_SANDBOX ? process.env.SANDBOX_SECRET : process.env.PRODUCTION_SECRET;
const PAYPAL_API_BASE = USE_SANDBOX ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';

// --- Saved-cart price-hold helpers (slice-2) ---
const PRICE_HOLD_MS = 7 * 24 * 60 * 60 * 1000; // honour the saved price for 7 days

// Deterministic signature of a price-less item list, so we can verify the cart
// being checked out is exactly the one that was saved (order/key-order agnostic).
function stableStringify(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}
function itemsSignature(items) {
    const arr = Array.isArray(items) ? items : [];
    return JSON.stringify(arr.map(stableStringify).sort());
}

async function getPayPalAccessToken() {
    const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
    const url = `${PAYPAL_API_BASE}/v1/oauth2/token`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
    });
    const responseText = await response.text();
    let data;
    try {
        data = JSON.parse(responseText);
    } catch (parseError) {
        throw new Error(`Non-JSON response from PayPal: ${responseText}`);
    }
    if (!response.ok) {
        throw new Error(`Failed to get PayPal access token. Status: ${response.status}, Message: ${data.error_description || data.error || 'Unknown error'}`);
    }
    if (!data.access_token) {
        throw new Error('PayPal response missing access token');
    }
    return data.access_token;
}

export default async function handler(req, res) {
    // --- CORS (unchanged policy) ---
    const allowedOrigins = [
        'http://localhost:19006',
        'http://localhost:3000',
        'https://fluidpowergroup.com.au',
    ];
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST', 'OPTIONS']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    console.log('Received request to /api/paypal/create-order (server-authority)');

    const { items, shipping, devMode, orderNumber, savedCartToken } = req.body || {};

    // Reject the legacy client-priced contract outright — this closes the hole.
    if (!Array.isArray(items)) {
        if (req.body && req.body.amount !== undefined) {
            return res.status(400).json({
                error: 'This endpoint no longer accepts a client-supplied amount. Send the price-less { items } contract; the server computes the price.',
            });
        }
        return res.status(400).json({ error: 'Missing required "items" array.' });
    }

    // The quote MUST be persisted for capture-time reconciliation. If Redis is
    // not configured, fail closed rather than fall back to an unverifiable order.
    if (!quoteStore.isConfigured()) {
        console.error('❌ Quote store (Upstash Redis) not configured — cannot create a verifiable order.');
        return res.status(503).json({ error: 'Checkout temporarily unavailable (pricing store not configured).' });
    }

    if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
        console.error('❌ Missing PayPal credentials');
        return res.status(500).json({ error: 'PayPal configuration error' });
    }

    try {
        // --- 1. Recompute every price from trusted data. ---
        const currentPricing = await priceCart(items);
        console.log(`🧾 Server-computed total: A$${currentPricing.amountValue} (subtotal ${currentPricing.subtotal}, gst ${currentPricing.gst})`);

        // --- 1b. Saved-cart 7-day price hold (slice-2). ---------------------
        // If this checkout was resumed from a "save cart for later" link, honour
        // the price quoted when it was saved — but ONLY if the token is valid,
        // within 7 days, and the cart is byte-for-byte unchanged. We charge the
        // LOWER of held vs current (never overcharge; pass on any price drop).
        // Everything is verified server-side against our own stored quote, so a
        // tampered/forged token can never lower the price.
        let pricing = currentPricing;
        let priceHoldApplied = false;
        if (savedCartToken) {
            try {
                const saved = await quoteStore.getSavedCart(savedCartToken);
                if (saved && saved.quote && saved.quote.amountValue && saved.savedAt) {
                    const within7d = (Date.now() - new Date(saved.savedAt).getTime()) <= PRICE_HOLD_MS;
                    const unchanged = itemsSignature(saved.serverItems) === itemsSignature(items);
                    if (within7d && unchanged) {
                        const heldIsLower = parseFloat(saved.quote.amountValue) <= parseFloat(currentPricing.amountValue);
                        pricing = heldIsLower ? saved.quote : currentPricing;
                        priceHoldApplied = true;
                        console.log(`🔒 Price hold applied: held A$${saved.quote.amountValue}, current A$${currentPricing.amountValue} → charging A$${pricing.amountValue}`);
                    } else {
                        console.log(`ℹ️ Price hold NOT applied (within7d=${within7d}, cartUnchanged=${unchanged}); using current price.`);
                    }
                }
            } catch (holdErr) {
                console.warn('⚠️ Price-hold lookup failed; using current price:', holdErr.message);
            }
        }

        // --- 2. Server-gated developer/test pricing (never client-forced). ---
        const dev = resolveDevPricing(devMode);
        const chargeValue = dev.active ? dev.amountValue : pricing.amountValue;
        if (dev.active) {
            console.log(`🔧 Server-gated test pricing applied: charging A$${chargeValue} (real total A$${pricing.amountValue})`);
        } else if (devMode && devMode.requested) {
            console.warn(`⚠️ Developer pricing requested but not honoured (${dev.reason || 'no'}). Charging full price.`);
        }

        // --- 3. Create the PayPal order for the SERVER amount. ---
        const accessToken = await getPayPalAccessToken();
        const orderPayload = {
            intent: 'CAPTURE',
            purchase_units: [{
                amount: { currency_code: pricing.currency, value: chargeValue },
                description: dev.active
                    ? `FluidPower Order - SERVER TEST - A$${chargeValue}`
                    : `FluidPower Group Order - A$${chargeValue}`,
            }],
            application_context: {
                brand_name: 'FluidPower Group',
                shipping_preference: 'NO_SHIPPING',
                user_action: 'PAY_NOW',
                landing_page: 'BILLING',
            },
        };

        const response = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'PayPal-Request-Id': `fpg-${Date.now()}`,
            },
            body: JSON.stringify(orderPayload),
        });

        const responseText = await response.text();
        let responseData;
        try {
            responseData = JSON.parse(responseText);
        } catch (parseError) {
            throw new Error(`Non-JSON response from PayPal Create Order: ${responseText}`);
        }
        if (!response.ok) {
            const errorMessage = responseData?.details?.[0]?.description || responseData?.message || `PayPal error: ${response.status}`;
            throw new Error(errorMessage);
        }

        const orderID = responseData.id;
        console.log('✅ PayPal order created:', orderID);

        // --- 4. Persist the quote (the authoritative record for capture). ---
        await quoteStore.saveQuote(orderID, {
            amountValue: chargeValue,        // what PayPal will be asked to capture
            currency: pricing.currency,
            devApplied: dev.active,
            priceHoldApplied,
            realAmountValue: pricing.amountValue,
            pricing: {
                subtotal: pricing.subtotal,
                shipping: pricing.shipping,
                gst: pricing.gst,
                total: pricing.total,
                lines: pricing.lines,
            },
            shippingAddress: shipping || null,
            internalOrderNumber: orderNumber || null,
            createdAt: new Date().toISOString(),
        });

        // --- 5. Return the orderID + amount + breakdown for display. ---
        return res.status(200).json({
            orderID,
            id: orderID, // legacy alias
            status: responseData.status,
            amount: { currency: pricing.currency, value: chargeValue },
            breakdown: {
                currency: pricing.currency,
                subtotal: pricing.subtotal,
                shipping: pricing.shipping,
                gst: pricing.gst,
                total: pricing.total,
                lines: pricing.lines.map((l) => ({ cartId: l.cartId, kind: l.kind, amount: l.amount, name: l.name })),
            },
        });

    } catch (error) {
        if (error instanceof PricingError) {
            console.error('❌ Pricing rejected order:', error.message, error.details || '');
            return res.status(400).json({ error: `Could not price your order: ${error.message}` });
        }
        console.error('Error in /api/paypal/create-order:', error);
        return res.status(500).json({
            error: error.message || 'Internal server error creating order.',
            timestamp: new Date().toISOString(),
        });
    }
}
