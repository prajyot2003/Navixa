// Shared abuse guard for Navixa's serverless endpoints.
//
// These endpoints are unauthenticated by design (the app has no server session),
// so the goal is not access control but making them uneconomical to abuse:
//   1. same-origin check  — blocks casual use of the relay from other sites
//   2. per-IP rate limit  — caps cost from any single source
//
// The limiter is in-memory and therefore per-instance and best-effort: serverless
// instances scale out and recycle, so a determined attacker can exceed the
// nominal rate. It stops opportunistic abuse and scrapers, not a funded
// adversary. A durable limit needs shared state (Vercel KV / Upstash Redis).

const HITS = new Map();

/** Allow same-origin/no-origin requests; block other websites' browsers. */
function originAllowed(req) {
  const origin = req.headers.origin || '';
  if (!origin) return true;                     // curl, server-side, same-origin GETs
  try {
    const host = new URL(origin).host;
    const self = req.headers['x-forwarded-host'] || req.headers.host || '';
    if (host === self) return true;
    return /(^|\.)vercel\.app$/.test(host) || host.startsWith('localhost:') || host === 'localhost';
  } catch { return false; }
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  return (Array.isArray(xf) ? xf[0] : String(xf || '')).split(',')[0].trim()
    || req.socket?.remoteAddress || 'unknown';
}

/**
 * Fixed-window per-IP limiter.
 * @returns {{ok: boolean, retryAfter: number}}
 */
function rateLimit(req, { limit = 20, windowMs = 60_000 } = {}) {
  const key = clientIp(req);
  const now = Date.now();
  const e = HITS.get(key);

  if (!e || now >= e.reset) {
    HITS.set(key, { count: 1, reset: now + windowMs });
    if (HITS.size > 5000) {                     // bound memory on a hot instance
      for (const [k, v] of HITS) if (now >= v.reset) HITS.delete(k);
    }
    return { ok: true, retryAfter: 0 };
  }
  e.count += 1;
  if (e.count > limit) return { ok: false, retryAfter: Math.ceil((e.reset - now) / 1000) };
  return { ok: true, retryAfter: 0 };
}

/** Applies both checks and writes the response if blocked. Returns true if blocked. */
function blocked(req, res, opts) {
  if (!originAllowed(req)) {
    res.status(403).json({ error: 'Forbidden' });
    return true;
  }
  const { ok, retryAfter } = rateLimit(req, opts);
  if (!ok) {
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({ error: 'Too many requests — slow down.', retryAfter });
    return true;
  }
  return false;
}

module.exports = { originAllowed, rateLimit, blocked };
