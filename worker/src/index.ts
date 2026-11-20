/**
 * astro-night-planning-live-data — the site's single data Worker.
 *
 * Free Workers plan only. Every request counts toward the account-wide
 * 100,000 requests/day (cache hits included); above that Cloudflare answers
 * with error 1027 instead of charging, which also caps R2 reads.
 *
 * Routes (GET/HEAD only, everything else 404/405):
 *   /tiles/<dataset>/<z>/<x>/<y>.<ext>   one tile from <dataset>.pmtiles in R2
 *   /hips/<gaia|gaia16>/properties        deep Gaia star layers for the sky engine (V<14, V<16)
 *   /hips/<layer>/Norder<o>/Dir<d>/Npix<p>.eph
 *   /data/<name>.json                     small JSON objects in R2 (e.g. latest.json)
 *   /dem/<Copernicus tile>/<same>.tif?r=a-b  one byte slice of a Copernicus DEM tile
 *                                         (no CORS on that bucket), max 4 MiB
 *   /7timer/<lat>/<lon>                   7Timer! ASTRO forecast (no CORS there)
 *   /aq/<lat>/<lon>                       measured air quality: nearest OpenAQ monitors,
 *                                         NowCast PM2.5/PM10 (needs the OPENAQ_KEY secret)
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
  HIPS_LAYERS,
  parseDem,
  parseDemSlice,
  parseHips,
  parseTile,
  parse7timer,
  dispatchRequest,
  workflowForCron,
  parseAq,
  nowCast,
  haversineKm,
  hourlySeries,
  OPENAQ,
  AQ_RADIUS_M,
  AQ_MAX_AGE_MS,
  AQ_READ,
  AQ_STATIONS,
} from './routes';

export interface Env {
  DATA: R2Bucket;
  /** Fine-grained GitHub token (this repo, Actions read/write), a Worker secret. */
  GH_DISPATCH_TOKEN?: string;
  /** OpenAQ v3 API key (free account), a Worker secret: measured air quality. */
  OPENAQ_KEY?: string;
}

/** Start a GitHub Actions workflow (the Worker's Cron Trigger). */
async function dispatchWorkflow(env: Env, workflow: string): Promise<void> {
  if (!env.GH_DISPATCH_TOKEN) {
    console.log(`cron: no GH_DISPATCH_TOKEN secret, not starting ${workflow}`);
    return;
  }
  // Trim: a pasted secret can carry a trailing newline.
  const [url, init] = dispatchRequest(workflow, env.GH_DISPATCH_TOKEN.trim());
  const r = await fetch(url, init);
  if (r.status !== 204) {
    console.error(
      `cron: GitHub answered ${r.status} for ${workflow}: ${(await r.text()).slice(0, 200)}`,
    );
  }
}

const DEM_ORIGIN = 'https://copernicus-dem-30m.s3.amazonaws.com';
const SEVEN_TIMER = 'https://www.7timer.info/bin/api.pl';

/** The archive is not in R2 (yet): a 404, not a server error. */
class MissingArchive extends Error {}

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
    if (!obj) throw new MissingArchive(this.key);
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
  const key = ds.key(t.dataset);
  let tile;
  try {
    tile = await archive(env, key).getZxy(t.z, t.x, t.y);
  } catch (e) {
    if (!(e instanceof MissingArchive)) throw e;
    archives.delete(key); // pick the file up once it is uploaded
    return notFound('public, max-age=60');
  }
  if (!tile) return notFound(ds.cache);
  return respond(tile.data, 200, { 'Content-Type': ds.type, 'Cache-Control': ds.cache });
}

async function serveHips(env: Env, path: string): Promise<Response> {
  const h = parseHips(path);
  if (!h) return notFound();
  const stem = HIPS_LAYERS[h.layer] ?? '';
  if (h.kind === 'properties') {
    const obj = await env.DATA.get(`${stem}.properties`);
    if (!obj) return notFound('public, max-age=600');
    return respond(obj.body, 200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    });
  }
  const { z, x, y } = hipsToTile(h.order, h.pix);
  const tile = await archive(env, `${stem}.pmtiles`).getZxy(z, x, y);
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

/**
 * One byte slice of a Copernicus DEM tile: /dem/<name>/<name>.tif?r=<start>-<end>.
 *
 * Workers Caching strips Range headers and caches by URL, so the slice is part
 * of the URL and the answer is a plain, cacheable 200 holding just those bytes
 * (X-File-Size carries the full file size). Whole-file pulls (≈30 MB) are
 * refused, so this cannot be used to stream entire tiles. DEM files never
 * change, so slices are cached for 30 days: a returning visitor or a nearby
 * location costs no Amazon request and no Worker run.
 */
async function proxyDem(req: Request, url: URL): Promise<Response> {
  const name = parseDem(url.pathname);
  if (!name) return notFound();
  const slice = parseDemSlice(url.search);
  if (!slice) {
    return respond('Need ?r=<start>-<end> (max 4 MiB)', 400, {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain',
    });
  }
  const up = await fetch(`${DEM_ORIGIN}/${name}/${name}.tif`, {
    method: req.method,
    headers: { Range: `bytes=${slice.start}-${slice.end}` },
  });
  // 403/404 from S3 means "no tile here" (open sea): pass it on as 404.
  if (up.status === 403 || up.status === 404) return notFound(IMMUTABLE);
  if (up.status === 416) {
    return respond('Range not satisfiable', 416, { 'Cache-Control': 'no-store' });
  }
  if (up.status !== 206) {
    // Upstream ignored the range (would be the whole file): refuse.
    await up.body?.cancel();
    return respond(`Unexpected upstream status ${up.status}`, 502, { 'Cache-Control': 'no-store' });
  }
  const total = /\/(\d+)$/.exec(up.headers.get('Content-Range') ?? '')?.[1];
  const out: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    'Cache-Control': 'public, max-age=2592000',
  };
  if (total) out['X-File-Size'] = total;
  return respond(up.body, 200, out);
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

// ---- measured air quality (OpenAQ v3) ---------------------------------------------

interface OaqSensor {
  id: number;
  parameter?: { name?: string };
}
interface OaqLocation {
  id: number;
  name?: string;
  isMonitor?: boolean;
  provider?: { name?: string };
  coordinates?: { latitude?: number; longitude?: number };
  sensors?: OaqSensor[];
  datetimeLast?: { utc?: string } | null;
}
interface OaqHour {
  value?: number | null;
  period?: { datetimeTo?: { utc?: string } };
}

async function oaq<T>(env: Env, path: string): Promise<T> {
  const r = await fetch(`${OPENAQ}${path}`, {
    headers: { 'X-API-Key': (env.OPENAQ_KEY ?? '').trim(), Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`OpenAQ ${r.status}`);
  return (await r.json()) as T;
}

/** Last 12 h of one sensor as a NowCast concentration, plus the newest hour. */
async function sensorNowCast(env: Env, id: number, now: number) {
  const from = new Date(now - 14 * 3600_000).toISOString();
  const d = await oaq<{ results?: OaqHour[] }>(
    env,
    `/sensors/${id}/hours?datetime_from=${encodeURIComponent(from)}&limit=24`,
  );
  const rows = (d.results ?? []).map((h) => ({
    value: h.value ?? null,
    end: Date.parse(h.period?.datetimeTo?.utc ?? ''),
  }));
  const { series, newest } = hourlySeries(rows);
  return { nowcast: nowCast(series), latest: series[0] ?? null, newest };
}

/**
 * /aq/<lat>/<lon>: the nearest reference monitors (up to 5 within 25 km, reported
 * in the last 3 h) with NowCast PM2.5 and PM10, as the EPA computes "current AQI".
 * Low-cost sensors are used only when no reference monitor is in range.
 * 503 without the OPENAQ_KEY secret (the site then shows the CAMS model).
 */
async function serveAq(env: Env, path: string): Promise<Response> {
  const p = parseAq(path);
  if (!p) return notFound();
  if (!env.OPENAQ_KEY)
    return respond('No station source configured', 503, {
      'Cache-Control': 'public, max-age=3600',
    });
  const now = Date.now();
  const loc = await oaq<{ results?: OaqLocation[] }>(
    env,
    `/locations?coordinates=${p.lat},${p.lon}&radius=${AQ_RADIUS_M}&parameters_id=2&limit=50`,
  );
  const fresh = (loc.results ?? [])
    .map((l) => ({
      l,
      km: haversineKm(
        p.lat,
        p.lon,
        l.coordinates?.latitude ?? NaN,
        l.coordinates?.longitude ?? NaN,
      ),
      last: Date.parse(l.datetimeLast?.utc ?? ''),
    }))
    .filter((x) => Number.isFinite(x.km) && now - x.last <= AQ_MAX_AGE_MS)
    .sort((a, b) => a.km - b.km);
  const monitors = fresh.filter((x) => x.l.isMonitor);
  const pick = (monitors.length ? monitors : fresh).slice(0, AQ_READ);
  const read = await Promise.all(
    pick.map(async ({ l, km }) => {
      const sensor = (name: string) => l.sensors?.find((s) => s.parameter?.name === name)?.id;
      const pm25Id = sensor('pm25');
      const pm10Id = sensor('pm10');
      const [pm25, pm10] = await Promise.all([
        pm25Id ? sensorNowCast(env, pm25Id, now).catch(() => null) : null,
        pm10Id ? sensorNowCast(env, pm10Id, now).catch(() => null) : null,
      ]);
      return {
        name: l.name ?? `OpenAQ ${l.id}`,
        provider: l.provider?.name ?? null,
        monitor: !!l.isMonitor,
        km: Math.round(km * 10) / 10,
        lat: l.coordinates?.latitude ?? null,
        lon: l.coordinates?.longitude ?? null,
        time: pm25?.newest ?? pm10?.newest ?? null,
        pm25: pm25?.nowcast ?? null,
        pm25Latest: pm25?.latest ?? null,
        pm10: pm10?.nowcast ?? null,
      };
    }),
  );
  // Stations with a recent PM2.5 hour first (nearest first), then the rest; at most AQ_STATIONS.
  const recent = (s: (typeof read)[number]) =>
    s.pm25 != null && s.time != null && now - s.time <= AQ_MAX_AGE_MS;
  const stations = [...read.filter(recent), ...read.filter((s) => !recent(s))].slice(
    0,
    AQ_STATIONS,
  );
  return respond(JSON.stringify({ source: 'openaq', fetched: now, stations }), 200, {
    'Content-Type': 'application/json',
    // Monitors report hourly; 20 minutes keeps us far inside OpenAQ's free rate limit.
    'Cache-Control': 'public, max-age=1200',
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return respond(null, 204, { 'Access-Control-Max-Age': '86400' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return respond('Method not allowed', 405);
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (path.startsWith('/tiles/')) return await serveTile(env, path);
      if (path.startsWith('/hips/')) return await serveHips(env, path);
      if (path.startsWith('/data/')) return await serveJson(env, path);
      if (path.startsWith('/dem/')) return await proxyDem(req, url);
      if (path.startsWith('/7timer/')) return await proxy7timer(path);
      if (path.startsWith('/aq/')) return await serveAq(env, path);
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
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const workflow = workflowForCron(controller.cron);
    if (workflow) ctx.waitUntil(dispatchWorkflow(env, workflow));
  },
} satisfies ExportedHandler<Env>;
