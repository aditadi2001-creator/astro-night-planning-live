/* Astro Night Planning service worker (generated at build time from src/pwa/sw-template.js).
 *
 * - App shell (page, scripts, styles, sky engine, icons) is cached on install, so the site
 *   opens offline. Each build gets its own cache; old ones are removed on activation.
 * - Same-origin static files (star tiles, catalogs, lazily loaded chunks) are cached the
 *   first time they are used and then served from the cache.
 * - Pages: network first (4 s), then the cached page.
 * - Live data (weather, aurora, tiles from the data Worker, other servers) is never
 *   handled here: the app keeps its own last good copy of each source with its age.
 *   Range requests and non-GET requests always go straight to the network.
 */
const VERSION = '__VERSION__';
const CACHE = `anp-${VERSION}`;
const PRECACHE = /* __PRECACHE__ */ [];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('anp-') && k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

async function pageFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([fetch(request), timeout(4000)]);
    if (res.ok) cache.put('/', res.clone());
    return res;
  } catch {
    return (await cache.match('/', { ignoreVary: true })) || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  // ignoreVary: servers send "Vary: Origin", and module scripts are requested with an
  // Origin header that the install-time requests did not have.
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(request);
  // Only whole, successful same-origin answers are kept.
  if (res.ok && res.status === 200 && res.type === 'basic') cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(pageFirst(request));
    return;
  }
  if (/^\/(assets|engine|skydata|icons)\//.test(url.pathname) || url.pathname === '/favicon.svg') {
    event.respondWith(cacheFirst(request));
  }
});
