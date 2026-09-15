// pages/api/tube360/submit-quote.js
// ============================================================================
// Tube360 "Upload your own file" - submit a quote request. NO payment.
// ============================================================================
// Flow:
//   1. The browser has already uploaded 1..maxFiles files into the business
//      SharePoint (<root>/_incoming/) via upload-start + upload-chunk. It sends
//      us only their uploadIds.
//   2. We validate the customer's details + tube spec, look every uploadId up
//      in Upstash (must be a COMPLETED upload we started), create the folder
//      "<root>/<ref> - <customer>" and MOVE the files into it.
//   3. Email the BUSINESS (folder + file links that only signed-in staff can
//      open, customer details, Reply-To = customer) - this one must succeed.
//   4. Email the CUSTOMER a confirmation (file NAMES only) - best-effort.
//   5. Once a day (Upstash lock, no cron): delete stale files in _incoming.
//
// Privacy: no customer data is stored by the website. The quote folder lives
// in the business's own SharePoint, like any other business document.
// ============================================================================

import { randomBytes } from 'crypto';
import { applyCors, rejectMethod, getClientIp, createRateLimiter, resolveSiteBase } from '../../../lib/tube360/http';
import * as cfg from '../../../lib/tube360/config';
import * as sharepoint from '../../../lib/tube360/sharepoint';
import * as uploadStore from '../../../lib/tube360/upload-store';
import { validateContact } from '../../../lib/tube360/contact-validation';
import { validateTube360Spec } from '../../../lib/pricing/tube360';
import { PricingError } from '../../../lib/pricing/errors';
import { businessEmail, isMailConfigured, getGraphAccessToken, sendGraphMail, TESTING_MODE } from '../../../lib/graph-mail';
import { generateTube360QuoteEmailTemplates, buildInvoiceBuilderQuoteLink } from '../../../lib/qstash-helper';

const limiter = createRateLimiter(5, 60 * 60 * 1000); // 5 submissions / hour / (email and IP)

/** e.g. TQ-260912-4F2A */
function makeQuoteRef() {
  const d = new Date();
  const yymmdd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `TQ-${yymmdd}-${randomBytes(2).toString('hex').toUpperCase()}`;
}

/** Run a best-effort task but never let it hold the response longer than ms. */
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve('timeout'), ms))]);
}

export default async function handler(req, res) {
  if (applyCors(req, res, ['POST'])) return;
  if (rejectMethod(req, res, ['POST'])) return;

  if (!sharepoint.isConfigured() || !uploadStore.isConfigured() || !isMailConfigured()) {
    console.error('[ERR] tube360 submit-quote: SharePoint, Upstash or Graph mail not configured');
    return res.status(503).json({ error: 'Quote requests are temporarily unavailable. Please call or email us.' });
  }

  const { contact: rawContact, spec, files, notes } = req.body || {};

  // ---- 1. Customer details (same rules as checkout) ----
  const contactCheck = validateContact(rawContact);
  if (!contactCheck.ok) {
    return res.status(400).json({ error: 'Please check your details.', fieldErrors: contactCheck.errors });
  }
  const contact = contactCheck.contact;

  // ---- 2. Rate limit (per email and per IP) ----
  const ip = getClientIp(req);
  if (!limiter.check(`email:${contact.email.toLowerCase()}`) || !limiter.check(`ip:${ip}`)) {
    return res.status(429).json({ error: 'Too many quote requests. Please try again later.' });
  }

  // ---- 3. Tube spec (no bend schedule in the upload flow) ----
  let entry;
  try {
    ({ entry } = validateTube360Spec(spec, { requireBends: false }));
  } catch (err) {
    if (err instanceof PricingError) {
      return res.status(400).json({ error: `Invalid tube details: ${err.message.replace(/^tube360: /, '')}` });
    }
    throw err;
  }

  // ---- 4. Files: each must be a COMPLETED upload that we started ----
  if (!Array.isArray(files) || files.length < 1 || files.length > cfg.uploads.maxFiles) {
    return res.status(400).json({ error: `Please upload between 1 and ${cfg.uploads.maxFiles} files.` });
  }
  const uploads = [];
  const seen = new Set();
  for (const f of files) {
    const uploadId = f && String(f.uploadId || '');
    if (seen.has(uploadId)) continue;
    seen.add(uploadId);
    let record;
    try {
      record = await uploadStore.getUpload(uploadId);
    } catch (err) {
      console.error('[ERR] tube360 submit-quote: store read failed:', err.message);
      return res.status(503).json({ error: 'Quote requests are temporarily unavailable. Please try again.' });
    }
    if (!record || record.status !== 'done' || !record.itemId) {
      return res.status(400).json({ error: 'One of your files was not uploaded completely. Please upload it again.' });
    }
    uploads.push({ uploadId, ...record });
  }

  const notesText = String(notes || '').slice(0, cfg.machine.maxNotesLength).trim();
  const ref = makeQuoteRef();

  // ---- 5. Create the quote folder and move the files into it ----
  let folder;
  const moved = [];
  try {
    folder = await sharepoint.createQuoteFolder(`${ref} - ${cfg.safeFolderText(contact.name) || 'Customer'}`);
    for (const u of uploads) {
      const item = await sharepoint.moveItem(u.itemId, folder.id, u.safeName);
      moved.push({ name: u.name, size: u.size, webUrl: item.webUrl });
    }
  } catch (err) {
    console.error(`[ERR] tube360 ${ref}: SharePoint folder/move failed:`, err.message);
    return res.status(502).json({ error: 'We could not save your files. Please try again.' });
  }
  // Single use: these uploads can't be submitted again.
  await Promise.all(uploads.map((u) => uploadStore.deleteUpload(u.uploadId).catch(() => {})));

  // ---- 6. Emails ----
  const siteBase = resolveSiteBase(req.headers.origin);
  const replyQuoteUrl = buildInvoiceBuilderQuoteLink({
    siteBase,
    ref,
    contact,
    labels: cfg.labelsFor(entry, spec),
    spec: { totalLengthMm: spec.totalLengthMm, quantity: spec.quantity },
    fileNames: moved.map((f) => f.name),
    notes: notesText,
  });
  const templates = generateTube360QuoteEmailTemplates(
    {
      ref,
      contact,
      spec: { catalogId: entry.id, totalLengthMm: spec.totalLengthMm, quantity: spec.quantity },
      labels: cfg.labelsFor(entry, spec),
      notes: notesText,
      files: moved,
      folderUrl: folder.webUrl,
      submittedAt: new Date().toISOString(),
      replyQuoteUrl,
    },
    { testingMode: TESTING_MODE, businessEmailDisplay: businessEmail() }
  );

  let accessToken;
  try {
    accessToken = await getGraphAccessToken();
    await sendGraphMail(accessToken, {
      to: businessEmail(),
      subject: `Tube360 quote request ${ref} - ${contact.name}`,
      html: templates.businessEmailContent,
      replyTo: contact.email,
    });
  } catch (err) {
    // Files are safely in SharePoint under this ref even if the email failed.
    console.error(`[ERR] tube360 ${ref}: business email failed:`, err.message);
    return res.status(502).json({ error: 'We could not submit your request just now. Please try again.' });
  }

  let customerEmailed = false;
  try {
    await sendGraphMail(accessToken, {
      to: contact.email,
      subject: `We've received your Tube360 drawing - ${ref}`,
      html: templates.customerEmailContent,
    });
    customerEmailed = true;
  } catch (err) {
    console.error(`[WARN] tube360 ${ref}: customer confirmation failed:`, err.message);
  }

  // ---- 7. Daily housekeeping of _incoming (no cron; at most once a day) ----
  try {
    if (await uploadStore.acquireDailyCleanupLock()) {
      const result = await withTimeout(sharepoint.cleanupIncoming(), 5000);
      console.log('[OK] tube360 _incoming cleanup:', JSON.stringify(result));
    }
  } catch (err) {
    console.warn('[WARN] tube360 _incoming cleanup failed:', err.message);
  }

  // Log without PII.
  console.log(`[OK] tube360 quote ${ref}: ${moved.length} file(s), business notified, customerEmailed=${customerEmailed}`);
  return res.status(200).json({ success: true, ref, customerEmailed });
}
