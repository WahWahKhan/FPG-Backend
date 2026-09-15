// lib/tube360/config.js
// ============================================================================
// TUBE360 configuration loader - the SINGLE source of truth for the Tube360
// catalogue, machine limits, pricing rates and upload rules.
// ============================================================================
// The frontend never keeps its own copy of these tables: it fetches the
// customer-safe subset from GET /api/tube360/options (publicOptions() below)
// and asks POST /api/tube360/price for every price it displays. That removes
// the "frontend copy drifted from backend copy" class of bug entirely
// (see the Trac360 addons.json and Hose360 pricing-port incidents).
//
// Edit the JSON files in lib/pricing/data/tube360/ to change sizes, limits or
// rates - no code change needed.
// ============================================================================

const catalog = require('../pricing/data/tube360/catalog.json');
const machine = require('../pricing/data/tube360/machine.json');
const rates = require('../pricing/data/tube360/rates.json');
const uploads = require('../pricing/data/tube360/uploads.json');

const TESTING_MODE = process.env.TESTING_MODE === 'true';

const tubesById = new Map(catalog.tubes.map((t) => [t.id, t]));

/** Catalogue row for a tube id (the Swell SKU), or null. */
function getCatalogEntry(id) {
  if (typeof id !== 'string') return null;
  return tubesById.get(id) || null;
}

/** Size band ('small' | 'medium' | 'large') used by the rate tables. */
function bandForOd(odMm) {
  const band = rates.sizeBands.find((b) => odMm <= b.maxOdMm);
  if (!band) throw new Error(`tube360 config: no size band covers OD ${odMm}mm`);
  return band.id;
}

function labelOf(list, id) {
  const found = list.find((x) => x.id === id);
  return found ? found.label : String(id);
}

function endLabel(endId) {
  const end = catalog.endTypes.find((e) => e.id === endId);
  if (!end) return String(endId);
  return end.id === 'none' ? end.label : `${end.label} (${end.description})`;
}

/** Human-readable labels for a spec - used by emails and the price breakdown. */
function labelsFor(entry, spec) {
  return {
    material: labelOf(catalog.materials, entry.material),
    sizeSystem: labelOf(catalog.sizeSystems, entry.sizeSystem),
    od: entry.odLabel,
    wallMm: entry.wallMm,
    grade: entry.grade,
    endA: endLabel(spec.endA),
    endB: endLabel(spec.endB),
  };
}

// ---- Uploads (SharePoint) ---------------------------------------------------

/** SharePoint root folder for THIS environment (test uploads never mix with live). */
function uploadRootFolder() {
  return TESTING_MODE ? uploads.rootFolderTest : uploads.rootFolderLive;
}

/** Lower-case extension after the LAST dot ('part.x_t' -> 'x_t'), or ''. */
function extensionOf(fileName) {
  const name = String(fileName || '');
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

function fileTypeFor(ext) {
  return uploads.fileTypes.find((f) => f.ext === ext) || null;
}

/**
 * SharePoint-safe file name: keeps the extension (lower-cased), replaces
 * anything outside [A-Za-z0-9._ ()-] with '-', trims, caps the base at 80 chars.
 */
function safeFileName(fileName) {
  const ext = extensionOf(fileName);
  const raw = String(fileName || '');
  const base = (ext ? raw.slice(0, -(ext.length + 1)) : raw)
    .replace(/[^A-Za-z0-9._ ()-]+/g, '-')
    .replace(/\.+/g, '.')
    .replace(/\s+/g, ' ')
    .replace(/^[-. ]+|[-. ]+$/g, '')
    .slice(0, 80) || 'drawing';
  return ext ? `${base}.${ext}` : base;
}

/** Folder-name-safe text for "<ref> - <customer>" (SharePoint forbids " * : < > ? / \\ |). */
function safeFolderText(text) {
  return String(text || '')
    .replace(/["*:<>?/\\|#%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 60);
}

/**
 * Validate an upload request from the browser.
 * Returns { ok: true, ext, safeName } or { ok: false, error }.
 */
function validateUploadRequest(fileName, size) {
  const ext = extensionOf(fileName);
  if (!fileTypeFor(ext)) {
    return { ok: false, error: `.${ext || '?'} files are not supported.` };
  }
  if (!Number.isInteger(size) || size < 1) {
    return { ok: false, error: 'File is empty.' };
  }
  if (size > uploads.maxFileSizeBytes) {
    return { ok: false, error: `File is larger than ${Math.round(uploads.maxFileSizeBytes / (1024 * 1024))} MB.` };
  }
  return { ok: true, ext, safeName: safeFileName(fileName) };
}

// ---- Public (customer-safe) options -----------------------------------------

/**
 * Everything the configurator UI needs, minus anything internal (Swell ids,
 * rates). Served by GET /api/tube360/options.
 */
function publicOptions(oversizeShipping) {
  return {
    version: catalog.version,
    materials: catalog.materials,
    sizeSystems: catalog.sizeSystems,
    endTypes: catalog.endTypes,
    tubes: catalog.tubes.map(({ swellProductId, ...rest }) => rest),
    machine: {
      minBendAngleDeg: machine.minBendAngleDeg,
      maxBendAngleDeg: machine.maxBendAngleDeg,
      minTotalLengthMm: machine.minTotalLengthMm,
      maxTotalLengthMm: machine.maxTotalLengthMm,
      maxBends: machine.maxBends,
      maxQuantity: machine.maxQuantity,
      maxNotesLength: machine.maxNotesLength,
    },
    uploads: {
      maxFiles: uploads.maxFiles,
      maxFileSizeBytes: uploads.maxFileSizeBytes,
      chunkSizeBytes: uploads.chunkSizeBytes,
      groups: uploads.groups,
      fileTypes: uploads.fileTypes,
    },
    freight: {
      oversizeThresholdMm: rates.oversizeFreightThresholdMm,
      oversizeShipping,
    },
  };
}

module.exports = {
  catalog,
  machine,
  rates,
  uploads,
  getCatalogEntry,
  bandForOd,
  labelsFor,
  endLabel,
  uploadRootFolder,
  extensionOf,
  fileTypeFor,
  safeFileName,
  safeFolderText,
  validateUploadRequest,
  publicOptions,
};
