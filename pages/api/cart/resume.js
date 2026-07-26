// pages/api/cart/resume.js
// ============================================================================
// Resume a saved cart by its opaque token. Returns ONLY the stored cart
// contents so the frontend can rehydrate localStorage. 410 if expired/unknown.
// ============================================================================

import * as quoteStore from '../../../lib/quote-store';

const TESTING_MODE = process.env.TESTING_MODE === 'true';
const allowedOrigins = [
    process.env.LOCAL_DEV_URL,
    process.env.API_BASE_URL,
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:19006',
    'https://fluidpowergroup.com.au',
    'https://www.fluidpowergroup.com.au',
].filter(Boolean);
const vercelPreviewPattern = /^https:\/\/fluidpowergroup-[a-z0-9]+-fluidpower\.vercel\.app$/;

export default async function handler(req, res) {
    const origin = req.headers.origin;
    if (origin && (allowedOrigins.includes(origin) || vercelPreviewPattern.test(origin) ||
        (TESTING_MODE && /^http:\/\/localhost:\d+$/.test(origin)))) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET', 'OPTIONS']);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const token = req.query.token;
    if (!token || typeof token !== 'string') {
        return res.status(400).json({ error: 'Missing cart token.' });
    }

    try {
        const saved = await quoteStore.getSavedCart(token);
        if (!saved) {
            // Expired or never existed — 410 lets the UI show a friendly message.
            return res.status(410).json({ error: 'This saved cart has expired or is no longer available.' });
        }
        if (saved.purchased) {
            // Single-use: this cart was already ordered. 409 + flag so the UI can
            // say "already ordered" rather than a generic "expired" message.
            return res.status(409).json({
                error: 'This saved cart has already been ordered and can no longer be checked out.',
                alreadyOrdered: true,
            });
        }
        if (!Array.isArray(saved.items)) {
            return res.status(410).json({ error: 'This saved cart has expired or is no longer available.' });
        }
        return res.status(200).json({
            success: true,
            items: saved.items,
            savedAt: saved.savedAt || null,
        });
    } catch (err) {
        console.error('[ERR] Resume cart failed:', err);
        return res.status(500).json({ error: 'Could not load your saved cart.' });
    }
}
