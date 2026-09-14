// lib/tube360/http.js
// Small shared HTTP helpers for the /api/tube360/* endpoints.
// CORS policy is copied from pages/api/cart/save.js (the most complete
// allowlist in this backend - it includes the www host and localhost:<port>
// in TESTING_MODE, which the sandbox frontend on :3010 needs).

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
// Matches BOTH Vercel URL shapes for this org's frontend deployments:
//   per-commit:  fluidpowergroup-<hash>-fluidpower.vercel.app
//   git-branch:  fluidpowergroup-git-<branch-name>-fluidpower.vercel.app  (stable per branch)
const vercelPreviewPattern = /^https:\/\/(?:fluidpowergroup-(?:git-[a-z0-9-]+|[a-z0-9]+)-fluidpower|fpg-frontend-(?:git-[a-z0-9-]+|[a-z0-9]+)-wahwahkhans-projects)\.vercel\.app$/;

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (allowedOrigins.includes(origin)) return true;
  if (vercelPreviewPattern.test(origin)) return true;
  return TESTING_MODE && /^http:\/\/localhost:\d+$/.test(origin);
}

/**
 * Apply CORS headers. Returns true when the request was an OPTIONS preflight
 * and has already been answered - the handler must then `return` immediately.
 * @param {string[]} methods e.g. ['POST'] or ['GET']
 */
function applyCors(req, res, methods) {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', [...methods, 'OPTIONS'].join(', '));
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

/** Reject any method not in `methods`. Returns true if it responded. */
function rejectMethod(req, res, methods) {
  if (methods.includes(req.method)) return false;
  res.setHeader('Allow', [...methods, 'OPTIONS']);
  res.status(405).json({ error: 'Method not allowed' });
  return true;
}

function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || 'unknown')
    .toString()
    .split(',')[0]
    .trim();
}

/**
 * In-memory sliding-window rate limiter (same approach as cart/save.js).
 * Per serverless instance - a speed bump against abuse, not a hard guarantee.
 */
function createRateLimiter(limit, windowMs) {
  const hits = new Map();
  return {
    check(key) {
      const now = Date.now();
      const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
  };
}

module.exports = { applyCors, rejectMethod, getClientIp, createRateLimiter, isAllowedOrigin };
