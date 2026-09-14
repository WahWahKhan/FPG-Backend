// pages/api/tube360/upload-chunk.js
// ============================================================================
// PUT ?uploadId=<id>&offset=<n>   body: raw bytes (application/octet-stream)
// Forwards one chunk of a file to its Graph upload session.
//   -> { done: false, nextOffset }                      more chunks expected
//   -> { done: true, uploadId, name, size }             file complete in SharePoint
//
// Chunks must arrive in order. Every chunk except the last must be exactly
// uploads.chunkSizeBytes (a multiple of 320 KiB, as Graph requires, and below
// Vercel's ~4.5 MB request-body limit).
// ============================================================================

import { applyCors, rejectMethod } from '../../../lib/tube360/http';
import * as cfg from '../../../lib/tube360/config';
import * as sharepoint from '../../../lib/tube360/sharepoint';
import * as uploadStore from '../../../lib/tube360/upload-store';

// We read the raw body ourselves (Next's JSON body parser must be off).
export const config = { api: { bodyParser: false } };

async function readRawBody(req, limit) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) {
      const err = new Error('Chunk too large');
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (applyCors(req, res, ['PUT'])) return;
  if (rejectMethod(req, res, ['PUT'])) return;

  const { uploadId } = req.query;
  const offset = Number(req.query.offset);
  const chunkSize = cfg.uploads.chunkSizeBytes;

  let record;
  try {
    record = await uploadStore.getUpload(String(uploadId || ''));
  } catch (err) {
    console.error('[ERR] tube360 upload-chunk: store read failed:', err.message);
    return res.status(503).json({ error: 'Upload temporarily unavailable. Please try again.' });
  }
  if (!record) return res.status(404).json({ error: 'Upload not found or expired. Please upload the file again.' });
  if (record.status === 'done') return res.status(409).json({ error: 'This file has already been uploaded.' });
  if (!Number.isInteger(offset) || offset !== record.nextOffset) {
    return res.status(409).json({ error: 'Chunk out of order.', nextOffset: record.nextOffset });
  }

  let body;
  try {
    body = await readRawBody(req, chunkSize);
  } catch (err) {
    return res.status(err.status || 400).json({ error: 'Invalid chunk.' });
  }

  const isLast = offset + body.length === record.size;
  if (body.length === 0 || offset + body.length > record.size || (!isLast && body.length !== chunkSize)) {
    return res.status(400).json({ error: 'Invalid chunk size.' });
  }

  try {
    const result = await sharepoint.putChunk(record.uploadUrl, body, offset, record.size);
    if (!result.done) {
      await uploadStore.saveUpload(uploadId, { ...record, nextOffset: offset + body.length });
      return res.status(200).json({ done: false, nextOffset: offset + body.length });
    }
    const itemId = result.item && result.item.id;
    if (!itemId) throw new Error('Graph did not return the uploaded item');
    await uploadStore.saveUpload(uploadId, { ...record, nextOffset: record.size, status: 'done', itemId });
    return res.status(200).json({ done: true, uploadId, name: record.name, size: record.size });
  } catch (err) {
    console.error(`[ERR] tube360 upload-chunk ${uploadId} @${offset}:`, err.message);
    if (err.status === 404) {
      await uploadStore.deleteUpload(uploadId).catch(() => {});
      return res.status(410).json({ error: 'The upload expired. Please upload the file again.' });
    }
    return res.status(502).json({ error: 'Upload failed. Please try again.' });
  }
}
