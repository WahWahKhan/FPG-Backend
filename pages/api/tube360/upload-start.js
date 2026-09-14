// pages/api/tube360/upload-start.js
// ============================================================================
// POST { fileName, size } -> { uploadId, chunkSize }
// Starts one file upload into the business SharePoint (<root>/_incoming/).
// The browser then sends the bytes in chunkSize pieces to
// PUT /api/tube360/upload-chunk?uploadId=...&offset=...
// ============================================================================

import { randomUUID } from 'crypto';
import { applyCors, rejectMethod, getClientIp, createRateLimiter } from '../../../lib/tube360/http';
import * as cfg from '../../../lib/tube360/config';
import * as sharepoint from '../../../lib/tube360/sharepoint';
import * as uploadStore from '../../../lib/tube360/upload-store';

const limiter = createRateLimiter(30, 60 * 60 * 1000); // 30 files / IP / hour

export default async function handler(req, res) {
  if (applyCors(req, res, ['POST'])) return;
  if (rejectMethod(req, res, ['POST'])) return;

  if (!sharepoint.isConfigured() || !uploadStore.isConfigured()) {
    console.error('[ERR] tube360 upload-start: SharePoint or Upstash not configured');
    return res.status(503).json({ error: 'File uploads are temporarily unavailable.' });
  }

  const { fileName, size } = req.body || {};
  const check = cfg.validateUploadRequest(fileName, size);
  if (!check.ok) return res.status(400).json({ error: check.error });

  if (!limiter.check(`ip:${getClientIp(req)}`)) {
    return res.status(429).json({ error: 'Too many uploads. Please try again later.' });
  }

  const uploadId = randomUUID();
  const storedName = `${uploadId}-${check.safeName}`;

  try {
    const session = await sharepoint.createIncomingUploadSession(storedName);
    await uploadStore.saveUpload(uploadId, {
      uploadUrl: session.uploadUrl,
      size,
      name: String(fileName).slice(0, 200),
      safeName: check.safeName,
      nextOffset: 0,
      status: 'uploading',
      itemId: null,
      createdAt: new Date().toISOString(),
    });
    return res.status(200).json({ uploadId, chunkSize: cfg.uploads.chunkSizeBytes });
  } catch (err) {
    console.error('[ERR] tube360 upload-start failed:', err.message);
    return res.status(502).json({ error: 'Could not start the upload. Please try again.' });
  }
}
