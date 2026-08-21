// Navixa service worker — keeps the app usable offline.
//
// Strategy is deliberately network-first for app code so a new deploy is picked
// up immediately when online; the cache is only a fallback. Live data (jobs,
// AI, Supabase) is never cached — those requests simply fail offline and the
// app already handles that.
const CACHE = 'navixa-shell-v1';

const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './manifest.json',
  './favicon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL).catch(() => {}))   // a missing file must not block install
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isAppAsset = (url) =>
  url.origin === self.location.origin
  && !url.pathname.startsWith('/api/')
  && /\.(?:html|css|js|svg|json|woff2?)$/.test(url.pathname) || url.pathname === '/';

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never touch API calls or third-party requests (Supabase, LLM, job boards, CDNs).
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (!isAppAsset(url)) return;

  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(request);
        if (hit) return hit;
        // SPA fallback: any navigation offline gets the cached shell.
        if (request.mode === 'navigate') {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      }),
  );
});
