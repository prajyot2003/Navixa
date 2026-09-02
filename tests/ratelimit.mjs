// Rate limiter tests: bucket isolation, both backends, and failure behaviour.
// The Redis path is exercised against a stub server, so no real Redis is needed.
import http from 'node:http';
import { createRequire } from 'node:module';

let pass = 0, fail = 0;
const t = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
};

const mkReq = (ip = '1.2.3.4', origin = '') => ({
  headers: { host: 'navixa.vercel.app', 'x-forwarded-for': ip, ...(origin ? { origin } : {}) },
  socket: {},
});
const mkRes = () => {
  const r = { code: null, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

/* ---------- in-memory backend (no Redis configured) ---------- */
console.log('\n[A] in-memory fallback (no Redis env)');
delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
const require1 = createRequire(import.meta.url);
const g1 = require1('../api/_guard.js');

t('degrades to memory when unconfigured', g1.REDIS_READY === false);

let firstBlock = null;
for (let i = 1; i <= 8; i++) {
  const r = await g1.rateLimit(mkReq('10.0.0.1'), { bucket: 'a', limit: 5, windowMs: 60_000 });
  if (!r.ok && firstBlock === null) firstBlock = i;
}
t('blocks on the request after the limit', firstBlock === 6, `blocked at ${firstBlock}, expected 6`);
t('reports the memory backend',
  (await g1.rateLimit(mkReq('10.0.0.9'), { bucket: 'a', limit: 5 })).backend === 'memory');

console.log('\n[B] buckets and callers are isolated');
const other = await g1.rateLimit(mkReq('10.0.0.1'), { bucket: 'b', limit: 5, windowMs: 60_000 });
t('a different bucket has its own budget (jobs must not eat the chat budget)', other.ok === true);
const otherIp = await g1.rateLimit(mkReq('10.0.0.2'), { bucket: 'a', limit: 5, windowMs: 60_000 });
t('a different IP has its own budget', otherIp.ok === true);

console.log('\n[C] origin check');
const res403 = mkRes();
t('cross-origin blocked with 403',
  (await g1.blocked(mkReq('10.0.0.3', 'https://evil.com'), res403, { bucket: 'c', limit: 5 })) === true && res403.code === 403);
t('same-origin allowed',
  (await g1.blocked(mkReq('10.0.0.4', 'https://navixa.vercel.app'), mkRes(), { bucket: 'c', limit: 5 })) === false);
t('no-origin (curl) allowed',
  (await g1.blocked(mkReq('10.0.0.5'), mkRes(), { bucket: 'c', limit: 5 })) === false);

/* ---------- Redis backend against a stub ---------- */
console.log('\n[D] Redis backend (stub server)');
const counters = new Map();
let mode = 'ok';
const server = http.createServer((req, res) => {
  if (mode === 'down') { res.destroy(); return; }
  if (mode === 'slow') { setTimeout(() => { res.writeHead(200); res.end('[]'); }, 4000); return; }
  if (mode === 'error') { res.writeHead(500); res.end('boom'); return; }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const cmds = JSON.parse(body);
    const key = cmds[0][1];
    const n = (counters.get(key) || 0) + 1;
    counters.set(key, n);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([{ result: n }, { result: 1 }, { result: 42 }]));
  });
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

process.env.KV_REST_API_URL = `http://127.0.0.1:${port}`;
process.env.KV_REST_API_TOKEN = 'test-token';
const require2 = createRequire(import.meta.url + '?2');
delete require2.cache?.[require2.resolve('../api/_guard.js')];
const g2 = require2('../api/_guard.js');

t('detects Redis configuration', g2.REDIS_READY === true);

let rBlock = null, usedRedis = false;
for (let i = 1; i <= 6; i++) {
  const r = await g2.rateLimit(mkReq('10.0.1.1'), { bucket: 'r', limit: 4, windowMs: 60_000 });
  if (r.backend === 'redis') usedRedis = true;
  if (!r.ok && rBlock === null) rBlock = i;
}
t('uses the Redis backend when configured', usedRedis);
t('Redis limit enforced at the right request', rBlock === 5, `blocked at ${rBlock}, expected 5`);
t('shares one counter across instances (single key)', counters.size === 1,
  `keys: ${[...counters.keys()].join(', ')}`);
t('Retry-After comes from the stored TTL',
  (await g2.rateLimit(mkReq('10.0.1.1'), { bucket: 'r', limit: 4 })).retryAfter === 42);
t('the IP is hashed, never stored raw', ![...counters.keys()].some((k) => k.includes('10.0.1.1')),
  `keys: ${[...counters.keys()].join(', ')}`);

console.log('\n[E] Redis failure must fail open to the in-memory limiter');
mode = 'down';
const down = await g2.rateLimit(mkReq('10.0.2.1'), { bucket: 'd', limit: 3, windowMs: 60_000 });
t('connection refused → falls back, still serves', down.ok === true && down.backend === 'memory');
mode = 'error';
const err = await g2.rateLimit(mkReq('10.0.2.2'), { bucket: 'd', limit: 3, windowMs: 60_000 });
t('HTTP 500 → falls back', err.ok === true && err.backend === 'memory');
mode = 'error';
let stillLimits = null;
for (let i = 1; i <= 5; i++) {
  const r = await g2.rateLimit(mkReq('10.0.2.3'), { bucket: 'd', limit: 3, windowMs: 60_000 });
  if (!r.ok && stillLimits === null) stillLimits = i;
}
t('limits still apply while Redis is down', stillLimits === 4, `blocked at ${stillLimits}`);

mode = 'slow';
const t0 = Date.now();
const slow = await g2.rateLimit(mkReq('10.0.3.1'), { bucket: 's', limit: 3, windowMs: 60_000 });
const took = Date.now() - t0;
t('slow Redis times out fast (<2s) instead of hanging the request', took < 2000, `took ${took}ms`);
t('slow Redis still returns a decision', slow.ok === true && slow.backend === 'memory');

server.close();
console.log(`\n${fail === 0 ? '✅' : '❌'} rate limiter: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
