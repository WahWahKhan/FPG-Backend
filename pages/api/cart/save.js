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
const { applyCors, resolveSiteBase } = require('../../../lib/tube360/http');
const { sendPostmarkEmail, isPostmarkConfigured } = require('../../../lib/email/postmark');
const { sendTelegramAlert, isTelegramConfigured } = require('../../../lib/alerts/telegram');

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

// CORS allowlist + site-base resolution now live in lib/tube360/http.js
// (single source of truth for the Vercel-preview pattern, shared with
// /api/tube360/*) — see [[fpg-save-cart-feature]] memory for the drift this
// used to cause.

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
    // Same test hook as send-email.js; ignored on the production deployment.
    if (process.env.EMAIL_SIMULATE_GRAPH_FAILURE === 'true' && process.env.VERCEL_ENV !== 'production') {
        throw new Error('Simulated Microsoft outage (EMAIL_SIMULATE_GRAPH_FAILURE=true)');
    }
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
    if (applyCors(req, res, ['POST'])) return; // OPTIONS preflight already answered

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
            year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Australia/Melbourne',
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

        const customerSubject = 'Your saved cart - FluidPower Group';
        let accessToken = null;
        try {
            accessToken = await getGraphAccessToken();
        } catch (tokenErr) {
            console.error('[WARN] Microsoft Graph unavailable for save-cart, using backups:', tokenErr.message);
        }

        // Customer copy is the priority: Graph, then the Postmark backup.
        let customerVia = null;
        if (accessToken) {
            try {
                await sendEmailViaGraph(accessToken, email.trim(), customerSubject, templates.customerEmailContent);
                customerVia = 'graph';
            } catch (custErr) {
                console.error('[WARN] Save-cart customer email via Graph failed:', custErr.message);
            }
        }
        if (!customerVia && isPostmarkConfigured()) {
            try {
                await sendPostmarkEmail({
                    to: email.trim(),
                    subject: TESTING_MODE ? `[TEST] ${customerSubject}` : customerSubject,
                    html: templates.customerEmailContent,
                    replyTo: BUSINESS_EMAIL,
                    tag: 'saved-cart-backup',
                });
                customerVia = 'postmark';
            } catch (pmErr) {
                console.error('[WARN] Save-cart Postmark backup failed:', pmErr.message);
            }
        }
        if (!customerVia) {
            throw new Error('Save-cart customer email failed on Microsoft Graph and the Postmark backup');
        }

        // Business copy is best-effort: Graph, then a Telegram note.
        let businessVia = null;
        if (accessToken) {
            try {
                await sendEmailViaGraph(accessToken, BUSINESS_EMAIL, `Cart saved for later${customerName ? ` - ${customerName}` : ''}`, templates.businessEmailContent);
                businessVia = 'graph';
            } catch (bizErr) {
                console.error('[WARN] Business save-cart notification failed:', bizErr.message);
            }
        }
        if (!businessVia && isTelegramConfigured()) {
            try {
                await sendTelegramAlert(
                    `${TESTING_MODE ? '[TEST] ' : ''}Cart saved for later - business email could not be sent\n\n` +
                    `Name: ${customerName || 'N/A'}\nEmail: ${email.trim()}\nItems: ${items.length}\n` +
                    `Open the cart: ${checkoutUrl}`
                );
                businessVia = 'telegram';
            } catch (tgErr) {
                console.error('[WARN] Save-cart Telegram note failed:', tgErr.message);
            }
        }

        console.log(`[OK] Cart saved (token ${token}); customer emailed via ${customerVia}; business ${businessVia ? `notified via ${businessVia}` : 'NOT notified'}.`);
        return res.status(200).json({ success: true, token });
    } catch (err) {
        console.error('[ERR] Save cart failed:', err);
        return res.status(500).json({ error: 'Could not save your cart. Please try again.' });
    }
}
