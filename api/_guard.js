// Shared abuse guard for Navixa's serverless endpoints.
//
// These endpoints are unauthenticated by design (the app has no server session),
// so the goal is not access control but making them uneconomical to abuse:
//   1. same-origin check — blocks other websites using them from a browser
//   2. per-IP rate limit  — caps cost from any single source
//
// The limiter uses Upstash Redis when configured, so the budget is shared across
// every serverless instance. Without it (a fresh clone, local dev, a fork with no
// Redis) it degrades to an in-memory limiter, which is per-instance and therefore
// best-effort. Set these to get the durable version — Vercel's Upstash Redis
// integration injects them automatically:
//   KV_REST_API_URL / KV_REST_API_TOKEN   (or UPSTASH_REDIS_REST_URL / …_TOKEN)
//
// Redis failures fail OPEN, falling through to the in-memory limiter: a Redis
// outage must not take the whole app down, but it should not remove all limits.

const crypto = require('crypto');

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const REDIS_READY = !!(REDIS_URL && REDIS_TOKEN);
const REDIS_TIMEOUT_MS = 1200;   // never let a slow store add latency to every request

const HITS = new Map();          // in-memory fallback

/** Allow same-origin / no-origin requests; block other websites' browsers. */
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
 * Bucketed key. The IP is hashed rather than stored raw — the limiter only needs
 * to tell callers apart, not to know who they are.
 */
function keyFor(req, bucket) {
  const h = crypto.createHash('sha256').update(clientIp(req)).digest('base64url').slice(0, 22);
  return `navixa:rl:${bucket}:${h}`;
}

/** Fixed-window counter in Redis. Returns null if unavailable, so the caller can fall back. */
async function redisCount(key, windowSec) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REDIS_TIMEOUT_MS);
  try {
    // One round trip: INCR, set the TTL only when absent (NX) so the window does
    // not slide on every hit, then read the TTL back for Retry-After.
    const res = await fetch(`${REDIS_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['INCR', key], ['EXPIRE', key, windowSec, 'NX'], ['TTL', key]]),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const out = await res.json();
    const count = Number(out?.[0]?.result);
    let ttl = Number(out?.[2]?.result);
    if (!Number.isFinite(count)) return null;
    if (!Number.isFinite(ttl) || ttl < 0) ttl = windowSec;
    return { count, ttl };
  } catch {
    return null;                                 // network error, timeout, bad JSON
  } finally {
    clearTimeout(timer);
  }
}

/** Per-instance fallback. */
function memoryCount(key, windowMs) {
  const now = Date.now();
  const e = HITS.get(key);
  if (!e || now >= e.reset) {
    HITS.set(key, { count: 1, reset: now + windowMs });
    if (HITS.size > 5000) {                      // bound memory on a hot instance
      for (const [k, v] of HITS) if (now >= v.reset) HITS.delete(k);
    }
    return { count: 1, ttl: Math.ceil(windowMs / 1000) };
  }
  e.count += 1;
  return { count: e.count, ttl: Math.ceil((e.reset - now) / 1000) };
}

/**
 * @returns {Promise<{ok: boolean, retryAfter: number, backend: 'redis'|'memory'}>}
 */
async function rateLimit(req, { bucket = 'default', limit = 20, windowMs = 60_000 } = {}) {
  const key = keyFor(req, bucket);
  const windowSec = Math.max(1, Math.ceil(windowMs / 1000));

  let hit = REDIS_READY ? await redisCount(key, windowSec) : null;
  const backend = hit ? 'redis' : 'memory';
  if (!hit) hit = memoryCount(key, windowMs);

  return hit.count > limit
    ? { ok: false, retryAfter: Math.max(1, hit.ttl), backend }
    : { ok: true, retryAfter: 0, backend };
}

/** Applies both checks and writes the response if blocked. Returns true if blocked. */
async function blocked(req, res, opts = {}) {
  if (!originAllowed(req)) {
    res.status(403).json({ error: 'Forbidden' });
    return true;
  }
  const { ok, retryAfter, backend } = await rateLimit(req, opts);
  if (!ok) {
    res.setHeader('Retry-After', String(retryAfter));
    res.setHeader('X-RateLimit-Backend', backend);
    res.status(429).json({ error: 'Too many requests — slow down.', retryAfter });
    return true;
  }
  return false;
}

module.exports = { originAllowed, rateLimit, blocked, REDIS_READY };
