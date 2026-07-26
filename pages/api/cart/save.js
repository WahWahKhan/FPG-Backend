// pages/api/cart/save.js
// ============================================================================
// "Save cart for later" — store an ANONYMOUS cart under an opaque token and
// email a resume link to the customer (+ a heads-up to the business).
// ============================================================================
// Privacy posture: only the cart CONTENTS are persisted (in Upstash Redis,
// keyed by a random token, 30-day TTL). No account, and no name/email is
// stored — the email address is used transiently to send the link and then
// discarded. This is the whole point of the design (avoids a customer DB).
// ============================================================================

import { randomUUID } from 'crypto';
import * as quoteStore from '../../../lib/quote-store';
import { generateSavedCartEmailTemplates } from '../../../lib/qstash-helper';
import { priceCart } from '../../../lib/pricing';

const TESTING_MODE = process.env.TESTING_MODE === 'true';
const AZURE_TENANT_ID = process.env.AZURE_TENANT_ID;
const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID;
const AZURE_CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET;

const BUSINESS_EMAIL = TESTING_MODE
    ? (process.env.BUSINESS_EMAIL_TEST || 'info@agcomponents.com.au')
    : process.env.BUSINESS_EMAIL;
const SENDER_EMAIL = TESTING_MODE
    ? (process.env.SENDER_EMAIL_TEST || process.env.SENDER_EMAIL)
    : process.env.SENDER_EMAIL;

const PROD_SITE_URL = 'https://fluidpowergroup.com.au';
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

// A customer-facing site origin we are willing to put in an outgoing email.
function resolveSiteBase(origin) {
    if (!origin) return PROD_SITE_URL;
    if (allowedOrigins.includes(origin)) return origin;
    if (vercelPreviewPattern.test(origin)) return origin;
    // Allow any localhost:<port> only during local/test (sandbox runs on :3010).
    if (TESTING_MODE && /^http:\/\/localhost:\d+$/.test(origin)) return origin;
    return PROD_SITE_URL;
}

// --- Simple in-memory rate limiting (per email + IP) ---
const requestTracker = new Map();
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;
function checkRateLimit(identifier) {
    const now = Date.now();
    const recent = (requestTracker.get(identifier) || []).filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length >= RATE_LIMIT) return false;
    recent.push(now);
    requestTracker.set(identifier, recent);
    return true;
}

// --- Microsoft Graph (self-contained; mirrors send-email.js) ---
async function getGraphAccessToken() {
    const params = new URLSearchParams();
    params.append('client_id', AZURE_CLIENT_ID);
    params.append('client_secret', AZURE_CLIENT_SECRET);
    params.append('scope', 'https://graph.microsoft.com/.default');
    params.append('grant_type', 'client_credentials');
    const resp = await fetch(`https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
    });
    if (!resp.ok) throw new Error(`Graph token failed: ${resp.status} - ${await resp.text()}`);
    return (await resp.json()).access_token;
}

async function sendEmailViaGraph(accessToken, toEmail, subject, htmlContent) {
    const finalSubject = TESTING_MODE ? `[TEST] ${subject}` : subject;
    const emailData = {
        message: {
            subject: finalSubject,
            body: { contentType: 'HTML', content: htmlContent },
            toRecipients: [{ emailAddress: { address: toEmail } }],
        },
        saveToSentItems: true,
    };
    const resp = await fetch(`https://graph.microsoft.com/v1.0/users/${SENDER_EMAIL}/sendMail`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(emailData),
    });
    if (resp.status !== 202) throw new Error(`Graph send failed: ${resp.status} - ${await resp.text()}`);
    return true;
}

const isValidEmail = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

export default async function handler(req, res) {
    const origin = req.headers.origin;
    if (origin && (allowedOrigins.includes(origin) || vercelPreviewPattern.test(origin) ||
        (TESTING_MODE && /^http:\/\/localhost:\d+$/.test(origin)))) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST', 'OPTIONS']);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!quoteStore.isConfigured()) {
        console.error('[WARN] Save cart unavailable: quote store (Upstash) not configured.');
        return res.status(503).json({ error: 'Save cart is temporarily unavailable.' });
    }

    const { items, serverItems, email, name, origin: bodyOrigin } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Your cart is empty.' });
    }
    if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'A valid email address is required.' });
    }

    // Anti-abuse: cap saves per email and per source IP.
    const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
        .toString().split(',')[0].trim();
    if (!checkRateLimit(`email:${email.toLowerCase()}`) || !checkRateLimit(`ip:${ip}`)) {
        return res.status(429).json({ error: 'Too many save requests. Please try again later.' });
    }

    try {
        const token = randomUUID();
        const customerName = (typeof name === 'string' ? name.trim() : '').slice(0, 80);

        // Compute the authoritative quote NOW so we can hold this price for 7
        // days (slice-2 price lock). Best-effort: if pricing fails (e.g. Swell
        // hiccup, out of stock), we still save the cart for resume — the price
        // hold simply won't apply and checkout will use the current price.
        let quote = null;
        let priceLockServerItems = null;
        if (Array.isArray(serverItems) && serverItems.length > 0) {
            try {
                const priced = await priceCart(serverItems);
                quote = {
                    amountValue: priced.amountValue,
                    currency: priced.currency,
                    subtotal: priced.subtotal,
                    shipping: priced.shipping,
                    gst: priced.gst,
                    total: priced.total,
                    lines: priced.lines,
                };
                priceLockServerItems = serverItems;
                console.log(`[OK] Saved-cart quote computed for hold: A$${priced.amountValue}`);
            } catch (priceErr) {
                console.warn('[WARN] Saved-cart pricing failed; saving without price hold:', priceErr.message);
            }
        }

        // Persist ONLY the cart contents (no PII). NOTE for production hardening:
        // custom-order PDFs are currently kept inline; offload them to Vercel Blob
        // (as send-cart-email.ts does) before storing, to keep the Redis value
        // small. Local/test keeps them inline so the resume round-trip is exact.
        const savedCart = {
            items,
            serverItems: priceLockServerItems,   // used to verify the cart is unchanged
            quote,                                // the held price (null if pricing failed)
            savedAt: new Date().toISOString(),    // start of the 7-day hold window
            version: 2,
        };
        await quoteStore.saveSavedCart(token, savedCart);

        const base = resolveSiteBase(bodyOrigin || origin);
        const checkoutUrl = `${base}/checkout?cart=${token}`;
        const catalogueUrl = `${base}/catalogue?cart=${token}`;

        // 7-day price-hold messaging (the actual server-side lock lands in slice 2).
        const holdDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const priceHoldUntil = holdDate.toLocaleDateString('en-AU', {
            year: 'numeric', month: 'long', day: 'numeric',
        });

        const templates = generateSavedCartEmailTemplates(
            { items },
            {
                customerName,
                checkoutUrl,
                catalogueUrl,
                priceHoldUntil,
                testingMode: TESTING_MODE,
                businessEmailDisplay: BUSINESS_EMAIL,
            }
        );

        const accessToken = await getGraphAccessToken();

        // Customer copy is the priority; business copy is best-effort.
        await sendEmailViaGraph(accessToken, email.trim(), 'Your saved cart - FluidPower Group', templates.customerEmailContent);
        let businessNotified = false;
        try {
            await sendEmailViaGraph(accessToken, BUSINESS_EMAIL, `Cart saved for later${customerName ? ` - ${customerName}` : ''}`, templates.businessEmailContent);
            businessNotified = true;
        } catch (bizErr) {
            console.error('[WARN] Business save-cart notification failed:', bizErr.message);
        }

        console.log(`[OK] Cart saved (token ${token}); customer emailed${businessNotified ? ', business notified' : ''}.`);
        return res.status(200).json({ success: true, token });
    } catch (err) {
        console.error('[ERR] Save cart failed:', err);
        return res.status(500).json({ error: 'Could not save your cart. Please try again.' });
    }
}
