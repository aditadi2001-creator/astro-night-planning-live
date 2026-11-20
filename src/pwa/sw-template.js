/* Astro Night Planning service worker (generated at build time from src/pwa/sw-template.js).
 *
 * - App shell (page, scripts, styles, sky engine, icons) is cached on install, so the site
 *   opens offline. Each build gets its own cache; old ones are removed on activation.
 * - Lazily loaded chunks are cached the first time they are used.
 * - Pages: network first (4 s), then the cached page.
 * - Data cache (kept across versions, at most 150 MB, least recently used dropped first):
 *   star tiles, catalogs and horizons from this site, tiles from the data Worker, and HiPS
 *   survey tiles from the public servers. A copy is used while its Cache-Control age allows,
 *   and any copy is used when the network fails (offline at a dark site).
 * - Live JSON (weather, aurora, …) is not handled here: the app keeps its own last good copy
 *   of each source with its age. Range and non-GET requests always go to the network.
 */
const VERSION = '__VERSION__';
const CACHE = `anp-${VERSION}`;
const PRECACHE = /* __PRECACHE__ */ [];
const DATA = 'anp-data-v1';
const META = 'anp-meta-v1';
const DATA_ORIGIN = '__DATA_ORIGIN__';
const CAP = 150 * 1024 * 1024;
/** When over the cap, drop the oldest entries down to this. */
const LOW = Math.round(CAP * 0.85);

/**
 * A file answered with the HTML page instead of itself. Cloudflare Pages does that for a path
 * it does not know yet, e.g. in the first moments after a deploy, before the new files reach
 * every edge. Such an answer must never be stored as a script: the site would stay blank.
 */
function wrongType(url, res) {
  const path = new URL(url, self.location.origin).pathname;
  return path !== '/' && /text\/html/i.test(res.headers.get('content-type') || '');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) =>
        Promise.all(
          PRECACHE.map(async (url) => {
            const res = await fetch(url, { cache: 'reload' });
            // Fail the install (the old version keeps running, retried on the next visit)
            // rather than keep a wrong or failed answer.
            if (!res.ok || wrongType(url, res)) throw new Error(`precache ${url}: ${res.status}`);
            await c.put(url, res);
          }),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('anp-') && k !== CACHE && k !== DATA && k !== META)
            .map((k) => caches.delete(k)),
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
  if (hit && !wrongType(request.url, hit)) return hit;
  if (hit) await cache.delete(request, { ignoreVary: true }); // heal a stored HTML answer
  const res = await fetch(request);
  // Only whole, successful same-origin answers of the right type are kept.
  if (res.ok && res.status === 200 && res.type === 'basic' && !wrongType(request.url, res))
    cache.put(request, res.clone());
  return res;
}

// ---- data cache with a size cap (least recently used first) -----------------------------
/** url → { size (bytes), used (ms), exp (ms; 0 = must revalidate) } */
let lru = null;
let saveTimer = 0;
async function index() {
  if (lru) return lru;
  try {
    const r = await (await caches.open(META)).match('/__lru.json');
    lru = r ? await r.json() : {};
  } catch {
    lru = {};
  }
  return lru;
}
function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = 0;
    const m = await caches.open(META);
    await m.put(
      '/__lru.json',
      new Response(JSON.stringify(lru), { headers: { 'content-type': 'application/json' } }),
    );
  }, 2000);
}
function total(ix) {
  let t = 0;
  for (const k in ix) t += ix[k]?.size || 0;
  return t;
}
async function trim(ix) {
  let t = total(ix);
  if (t <= CAP) return;
  const c = await caches.open(DATA);
  const old = Object.entries(ix)
    .filter((x) => x[1])
    .sort((a, b) => a[1].used - b[1].used);
  for (const [url, e] of old) {
    if (t <= LOW) break;
    await c.delete(url);
    ix[url] = undefined;
    t -= e.size || 0;
  }
}
function maxAgeMs(res, fallbackS) {
  const cc = res.headers.get('cache-control') || '';
  if (/no-store/.test(cc)) return -1;
  const m = /max-age=(\d+)/.exec(cc);
  return (m ? Number(m[1]) : fallbackS) * 1000;
}
async function dataFirst(request, fallbackS) {
  const ix = await index();
  const c = await caches.open(DATA);
  const key = request.url;
  const e = ix[key];
  const hit = e ? await c.match(key, { ignoreVary: true }) : undefined;
  if (hit && e.exp > Date.now()) {
    e.used = Date.now();
    persist();
    return hit;
  }
  try {
    const res = await fetch(request);
    // Whole, readable answers only (opaque responses have an unknown, padded size).
    if (res.ok && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
      const age = maxAgeMs(res, fallbackS);
      if (age >= 0) {
        const body = await res.clone().blob();
        await c.put(key, res.clone());
        ix[key] = { size: body.size, used: Date.now(), exp: Date.now() + age };
        await trim(ix);
        persist();
      }
    }
    return res;
  } catch (err) {
    if (hit) {
      e.used = Date.now();
      persist();
      return hit;
    }
    throw err;
  }
}
const HIPS_TILE = /\/Norder\d+\/Dir\d+\/Npix\d+\.(jpg|jpeg|png|webp)$/i;

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  const reply = (v) => event.ports[0]?.postMessage(v);
  if (msg.type === 'data-status') {
    event.waitUntil(
      index().then((ix) => reply({ bytes: total(ix), entries: Object.keys(ix).length, cap: CAP })),
    );
  } else if (msg.type === 'data-clear') {
    event.waitUntil(
      caches.delete(DATA).then(async () => {
        lru = {};
        await caches.delete(META);
        reply({ bytes: 0, entries: 0, cap: CAP });
      }),
    );
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    // The data Worker's tiles and public HiPS survey tiles (cached offline, capped).
    if ((DATA_ORIGIN && url.origin === DATA_ORIGIN) || HIPS_TILE.test(url.pathname))
      event.respondWith(dataFirst(request, 30 * 86400));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(pageFirst(request));
    return;
  }
  if (/^\/(skydata|catalog|data|horizons)\//.test(url.pathname)) {
    event.respondWith(dataFirst(request, 7 * 86400));
    return;
  }
  if (/^\/(assets|engine|icons)\//.test(url.pathname) || url.pathname === '/favicon.svg') {
    event.respondWith(cacheFirst(request));
  }
});
