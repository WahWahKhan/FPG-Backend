// lib/tube360/sharepoint.js
// ============================================================================
// Minimal Microsoft Graph client for the Tube360 SharePoint document library.
// ============================================================================
// Uses the SAME Azure app + client-credentials token as the order emails
// (lib/graph-mail.js getGraphAccessToken). The app is granted "write" on ONE
// SharePoint site only (Graph application permission Sites.Selected), whose
// id is in env TUBE360_SP_SITE_ID. Everything lives in that site's default
// document library ("Documents"):
//
//   <root>/_incoming/<uploadId>-<file>     uploaded, not yet submitted
//   <root>/<ref> - <customer>/<file>       submitted quote request
//
// <root> = "Tube360 Quotes" (live) or "Tube360 Quotes - TEST" (TESTING_MODE).
// Abandoned, never-completed upload sessions are discarded by Microsoft
// automatically; completed-but-never-submitted files in _incoming are removed
// by cleanupIncoming() (throttled to once a day, no cron needed).
// ============================================================================

const { getGraphAccessToken } = require('../graph-mail');
const cfg = require('./config');

const GRAPH = 'https://graph.microsoft.com/v1.0';

function siteId() {
  const id = process.env.TUBE360_SP_SITE_ID;
  if (!id) throw new Error('TUBE360_SP_SITE_ID is not configured');
  return id;
}

function isConfigured() {
  return Boolean(process.env.TUBE360_SP_SITE_ID);
}

/** Encode a drive-relative path segment by segment ("A B/c.pdf" -> "A%20B/c.pdf"). */
function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function graph(method, url, body, extraHeaders = {}) {
  const token = await getGraphAccessToken();
  const resp = await fetch(url.startsWith('http') ? url : `${GRAPH}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...extraHeaders,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!resp.ok) {
    const msg = (data && data.error && (data.error.message || data.error.code)) || text || `HTTP ${resp.status}`;
    const err = new Error(`Graph ${method} ${url.split('?')[0]} failed: ${resp.status} ${msg}`);
    err.status = resp.status;
    throw err;
  }
  return data;
}

const drive = () => `/sites/${siteId()}/drive`;

/** Create a folder under a parent path if it doesn't exist; returns the folder item. */
async function ensureFolder(parentPath, name) {
  const parentUrl = parentPath ? `${drive()}/root:/${encodePath(parentPath)}:/children` : `${drive()}/root/children`;
  try {
    return await graph('POST', parentUrl, { name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' });
  } catch (err) {
    if (err.status !== 409) throw err; // 409 = already exists
    const path = parentPath ? `${parentPath}/${name}` : name;
    return graph('GET', `${drive()}/root:/${encodePath(path)}`);
  }
}

// Folders only need creating once per server instance.
let foldersReady = null;
function ensureIncomingFolders() {
  if (!foldersReady) {
    const root = cfg.uploadRootFolder();
    foldersReady = ensureFolder('', root)
      .then(() => ensureFolder(root, cfg.uploads.incomingFolder))
      .catch((err) => {
        foldersReady = null; // retry next time
        throw err;
      });
  }
  return foldersReady;
}

/**
 * Start a Graph upload session for a new file in <root>/_incoming/.
 * Returns { uploadUrl, expirationDateTime }. The uploadUrl is a
 * pre-authenticated capability: keep it server-side, never send it to the browser.
 */
async function createIncomingUploadSession(storedName) {
  await ensureIncomingFolders();
  const path = `${cfg.uploadRootFolder()}/${cfg.uploads.incomingFolder}/${storedName}`;
  return graph('POST', `${drive()}/root:/${encodePath(path)}:/createUploadSession`, {
    item: { '@microsoft.graph.conflictBehavior': 'rename' },
  });
}

/**
 * Forward one chunk to a Graph upload session (NO Authorization header - the
 * uploadUrl is pre-authenticated; sending a token can cause a 401).
 * Returns { done: false } for 202, or { done: true, item } when the file is complete.
 */
async function putChunk(uploadUrl, buffer, start, totalSize) {
  const end = start + buffer.length - 1;
  const resp = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Length': String(buffer.length),
      'Content-Range': `bytes ${start}-${end}/${totalSize}`,
    },
    body: buffer,
  });
  const text = await resp.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (resp.status === 202) return { done: false };
  if (resp.status === 200 || resp.status === 201) return { done: true, item: data };
  const err = new Error(`Graph upload chunk failed: ${resp.status} ${text.slice(0, 200)}`);
  err.status = resp.status;
  throw err;
}

/** Create "<root>/<folderName>" (renamed automatically if it exists). */
async function createQuoteFolder(folderName) {
  const root = cfg.uploadRootFolder();
  return graph('POST', `${drive()}/root:/${encodePath(root)}:/children`, {
    name: folderName,
    folder: {},
    '@microsoft.graph.conflictBehavior': 'rename',
  });
}

/** Move a drive item into a folder and give it a new name. Returns the updated item. */
async function moveItem(itemId, folderId, newName) {
  return graph(
    'PATCH',
    `${drive()}/items/${encodeURIComponent(itemId)}?@microsoft.graph.conflictBehavior=rename`,
    { parentReference: { id: folderId }, name: newName }
  );
}

async function getItem(itemId) {
  return graph('GET', `${drive()}/items/${encodeURIComponent(itemId)}?$select=id,name,size,webUrl,parentReference,createdDateTime`);
}

/**
 * Delete completed-but-never-submitted files in <root>/_incoming older than
 * uploads.incomingRetentionHours. Bounded work (max 50 deletions per run).
 * Returns { scanned, deleted }.
 */
async function cleanupIncoming() {
  const path = `${cfg.uploadRootFolder()}/${cfg.uploads.incomingFolder}`;
  const cutoff = Date.now() - cfg.uploads.incomingRetentionHours * 60 * 60 * 1000;
  const list = await graph('GET', `${drive()}/root:/${encodePath(path)}:/children?$select=id,name,createdDateTime&$top=200`);
  const items = (list && list.value) || [];
  let deleted = 0;
  for (const item of items) {
    if (deleted >= 50) break;
    if (new Date(item.createdDateTime).getTime() < cutoff) {
      await graph('DELETE', `${drive()}/items/${encodeURIComponent(item.id)}`);
      deleted++;
    }
  }
  return { scanned: items.length, deleted };
}

/** Connectivity check used by the plan's setup step: can we see the site's drive? */
async function checkAccess() {
  const d = await graph('GET', `${drive()}?$select=id,name,webUrl`);
  return { driveName: d.name, webUrl: d.webUrl };
}

module.exports = {
  isConfigured,
  createIncomingUploadSession,
  putChunk,
  createQuoteFolder,
  moveItem,
  getItem,
  cleanupIncoming,
  checkAccess,
};
