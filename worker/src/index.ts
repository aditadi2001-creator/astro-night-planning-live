/**
 * astro-night-planning-live-data — the site's single data Worker.
 *
 * Free Workers plan only. Every request counts toward the account-wide
 * 100,000 requests/day (cache hits included); above that Cloudflare answers
 * with error 1027 instead of charging, which also caps R2 reads.
 *
 * Routes (GET/HEAD only, everything else 404/405):
 *   /tiles/<dataset>/<z>/<x>/<y>.<ext>   one tile from <dataset>.pmtiles in R2
 *   /hips/gaia/properties                 deep Gaia star layer for the sky engine
 *   /hips/gaia/Norder<o>/Dir<d>/Npix<p>.eph
 *   /data/<name>.json                     small JSON objects in R2 (e.g. latest.json)
 *   /dem/<Copernicus tile>/<same>.tif     pass-through to the Copernicus DEM bucket
 *                                         (no CORS there), Range requests supported
 *   /7timer/<lat>/<lon>                   7Timer! ASTRO forecast (no CORS there)
 *
 * Tiles are served one per URL so Workers Caching can keep each of them (the
 * cache is keyed by URL, not byte range). The Worker does the range read
 * inside R2 itself: one Class B operation per cache miss.
 */
import { PMTiles, type RangeResponse, type Source } from 'pmtiles';
import {
  DATASETS,
  corsHeaders,
  hipsToTile,
  parseDem,
  parseHips,
  parseTile,
  parse7timer,
} from './routes';

export interface Env {
  DATA: R2Bucket;
}

const DEM_ORIGIN = 'https://copernicus-dem-30m.s3.amazonaws.com';
const SEVEN_TIMER = 'https://www.7timer.info/bin/api.pl';

/** PMTiles source reading byte ranges from an R2 object. */
class R2Source implements Source {
  constructor(
    private bucket: R2Bucket,
    private key: string,
  ) {}
  getKey(): string {
    return this.key;
  }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const obj = await this.bucket.get(this.key, { range: { offset, length } });
    if (!obj) throw new Error(`missing ${this.key}`);
    const data = await obj.arrayBuffer();
    return { data, etag: obj.etag };
  }
}

// One PMTiles reader per archive per isolate: header and directories are
// cached in memory, so most tile requests cost a single R2 range read.
const archives = new Map<string, PMTiles>();
function archive(env: Env, key: string): PMTiles {
  let a = archives.get(key);
  if (!a) {
    a = new PMTiles(new R2Source(env.DATA, key));
    archives.set(key, a);
  }
  return a;
}

function respond(body: BodyInit | null, status: number, headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  for (const [k, v] of Object.entries(corsHeaders())) h.set(k, v);
  return new Response(body, { status, headers: h });
}

const IMMUTABLE = 'public, max-age=31536000, immutable';
const notFound = (cache = 'public, max-age=3600') =>
  respond('Not found', 404, { 'Cache-Control': cache, 'Content-Type': 'text/plain' });

async function serveTile(env: Env, path: string): Promise<Response> {
  const t = parseTile(path);
  if (!t) return notFound();
  const ds = DATASETS[t.dataset.kind];
  const tile = await archive(env, ds.key(t.dataset)).getZxy(t.z, t.x, t.y);
  if (!tile) return notFound(ds.cache);
  return respond(tile.data, 200, { 'Content-Type': ds.type, 'Cache-Control': ds.cache });
}

const GAIA_KEY = 'stars/gaia-deep-v1.pmtiles';

async function serveHips(env: Env, path: string): Promise<Response> {
  const h = parseHips(path);
  if (!h) return notFound();
  if (h.kind === 'properties') {
    const obj = await env.DATA.get('stars/gaia-deep-v1.properties');
    if (!obj) return notFound('public, max-age=600');
    return respond(obj.body, 200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    });
  }
  const { z, x, y } = hipsToTile(h.order, h.pix);
  const tile = await archive(env, GAIA_KEY).getZxy(z, x, y);
  // Short cache: a rebuilt archive (new key version) may add this tile later.
  if (!tile) return notFound('public, max-age=86400');
  return respond(tile.data, 200, {
    'Content-Type': 'application/octet-stream',
    'Cache-Control': IMMUTABLE,
  });
}

async function serveJson(env: Env, path: string): Promise<Response> {
  const m = /^\/data\/([a-z0-9_-]{1,40})\.json$/.exec(path);
  if (!m) return notFound();
  const obj = await env.DATA.get(`data/${m[1]}.json`);
  if (!obj) return notFound('public, max-age=60');
  return respond(obj.body, 200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=300',
  });
}

async function proxyDem(req: Request, path: string): Promise<Response> {
  const name = parseDem(path);
  if (!name) return notFound();
  const headers = new Headers();
  const range = req.headers.get('Range');
  // The terrain reader only ever asks for byte ranges; refuse whole-file pulls
  // (≈30 MB each) so the proxy cannot be used to stream entire tiles.
  if (!range || !/^bytes=\d+-\d+$/.test(range)) {
    return respond('A single byte Range is required', 416, { 'Cache-Control': 'no-store' });
  }
  const [start, end] = range.slice(6).split('-').map(Number) as [number, number];
  if (end - start > 4 * 1024 * 1024) {
    return respond('Range too large (max 4 MiB)', 416, { 'Cache-Control': 'no-store' });
  }
  headers.set('Range', range);
  const up = await fetch(`${DEM_ORIGIN}/${name}/${name}.tif`, { method: req.method, headers });
  // 403/404 from S3 means "no tile here" (open sea): pass it on as 404.
  if (up.status === 403 || up.status === 404) return notFound(IMMUTABLE);
  const out = new Headers();
  for (const k of [
    'Content-Type',
    'Content-Length',
    'Content-Range',
    'Accept-Ranges',
    'ETag',
    'Last-Modified',
  ]) {
    const v = up.headers.get(k);
    if (v) out.set(k, v);
  }
  // Byte-range responses must not go into the URL-keyed Worker cache.
  out.set('Cache-Control', 'private, no-store');
  return respond(up.body, up.status, out);
}

async function proxy7timer(path: string): Promise<Response> {
  const p = parse7timer(path);
  if (!p) return notFound();
  const url = `${SEVEN_TIMER}?lon=${p.lon}&lat=${p.lat}&product=astro&output=json`;
  const up = await fetch(url, {
    headers: { 'User-Agent': 'astro-night-planning-live (non-commercial)' },
  });
  if (!up.ok) return respond(`7Timer! error ${up.status}`, 502, { 'Cache-Control': 'no-store' });
  return respond(await up.text(), 200, {
    'Content-Type': 'application/json',
    // 7Timer! updates every 3 hours.
    'Cache-Control': 'public, max-age=10800',
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return respond(null, 204, { 'Access-Control-Max-Age': '86400' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return respond('Method not allowed', 405);
    const path = new URL(req.url).pathname;
    try {
      if (path.startsWith('/tiles/')) return await serveTile(env, path);
      if (path.startsWith('/hips/gaia/')) return await serveHips(env, path);
      if (path.startsWith('/data/')) return await serveJson(env, path);
      if (path.startsWith('/dem/')) return await proxyDem(req, path);
      if (path.startsWith('/7timer/')) return await proxy7timer(path);
      if (path === '/' || path === '/health')
        return respond('ok', 200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      return notFound();
    } catch (e) {
      return respond(`Upstream error: ${e instanceof Error ? e.message : String(e)}`, 502, {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain',
      });
    }
  },
} satisfies ExportedHandler<Env>;
