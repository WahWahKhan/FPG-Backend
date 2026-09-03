// pages/api/paypal/quote.js
// ============================================================================
// Read-only pricing endpoint. Runs the SAME priceCart() the money path runs, so
// the checkout page can display server-authoritative totals while the customer
// is still reviewing — instead of only learning them at PayPal-click time.
//
// Deliberately does NOT: call PayPal, create an order, write to Redis, or apply
// developer pricing / saved-cart price holds. Both of those only ever LOWER the
// charged amount, so this endpoint may quote slightly high in those two edge
// cases and never low. create-order remains the sole price authority at capture.
// ============================================================================

import { priceCart, PricingError } from '../../../lib/pricing';

export default async function handler(req, res) {
    // CORS policy copied verbatim from create-order.js — keep them identical.
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

    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Missing required "items" array.' });
    }

    try {
        const pricing = await priceCart(items);
        return res.status(200).json({
            breakdown: {
                subtotal: pricing.subtotal,
                shipping: pricing.shipping,
                gst: pricing.gst,
                total: pricing.total,
                lines: pricing.lines,
            },
        });
    } catch (err) {
        if (err instanceof PricingError) {
            return res.status(400).json({ error: err.message });
        }
        console.error('quote endpoint failed:', err);
        return res.status(500).json({ error: 'Could not price cart.' });
    }
}
