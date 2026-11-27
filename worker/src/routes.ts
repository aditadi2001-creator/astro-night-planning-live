/**
 * Pure routing helpers for the data Worker (unit-tested in tests/worker-routes.test.ts).
 * Every route is a strict allow-list so the Worker can never be used as an
 * open proxy or to read arbitrary objects from the bucket.
 */

export type DatasetRef =
  | { kind: 'lightpollution'; year: number } // modelled sky brightness, zoom 0–8
  | { kind: 'lprad'; year: number } // night-lights radiance for light domes, zoom 0–6
  | { kind: 'lphist'; year: number } // sky brightness history for the year player, zoom 0–6
  | { kind: 'clouds'; hour: string }; // YYYYMMDDHH (UTC)

export const DATASETS = {
  lightpollution: {
    key: (d: DatasetRef) => `lightpollution/lp-${(d as { year: number }).year}.pmtiles`,
    type: 'image/webp',
    cache: 'public, max-age=31536000, immutable',
  },
  lprad: {
    key: (d: DatasetRef) => `lightpollution/lprad-${(d as { year: number }).year}.pmtiles`,
    type: 'image/webp',
    cache: 'public, max-age=31536000, immutable',
  },
  lphist: {
    key: (d: DatasetRef) => `lightpollution/history/lp-${(d as { year: number }).year}.pmtiles`,
    type: 'image/webp',
    cache: 'public, max-age=31536000, immutable',
  },
  clouds: {
    key: (d: DatasetRef) => `clouds/hourly/${(d as { hour: string }).hour}.pmtiles`,
    type: 'image/webp',
    // Each hourly archive never changes once written.
    cache: 'public, max-age=31536000, immutable',
  },
} as const;

export interface TileRef {
  dataset: DatasetRef;
  z: number;
  x: number;
  y: number;
}

/** /tiles/lightpollution-2025/7/64/42.webp, /tiles/lprad-2025/6/1/2.webp, /tiles/clouds-2026111214/5/10/12.webp */
export function parseTile(path: string): TileRef | null {
  const m =
    /^\/tiles\/(lightpollution-(\d{4})|lprad-(\d{4})|clouds-(\d{10})|lphist-(\d{4}))\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.(webp|png)$/.exec(
      path,
    );
  if (!m) return null;
  const z = Number(m[6]);
  const x = Number(m[7]);
  const y = Number(m[8]);
  if (z > 16 || x >= 2 ** z || y >= 2 ** z) return null;
  const dataset: DatasetRef = m[2]
    ? { kind: 'lightpollution', year: Number(m[2]) }
    : m[3]
      ? { kind: 'lprad', year: Number(m[3]) }
      : m[5]
        ? { kind: 'lphist', year: Number(m[5]) }
        : { kind: 'clouds', hour: m[4] ?? '' };
  return { dataset, z, x, y };
}

/** Deep star layers by URL name → R2 key stem (tiles are immutable: a rebuild gets a new name). */
export const HIPS_LAYERS: Record<string, string> = {
  gaia: 'stars/gaia-deep-v1', // V 10–14 (2026-11-12)
  gaia16: 'stars/gaia-deep-v2', // V 10–16 (2026-11-14)
  dso: 'dso/deep-v1', // OpenNGC + PGC + nebula catalogues (2026-11-14)
  dso2: 'dso/deep-v2', // the same + SDSS DR17 spectroscopic galaxies (2026-11-14)
};

export type HipsRef = { layer: string } & (
  { kind: 'properties' } | { kind: 'tile'; order: number; pix: number }
);

/** /hips/<layer>/properties or /hips/<layer>/Norder5/Dir10000/Npix12345.eph */
export function parseHips(path: string): HipsRef | null {
  const m0 = /^\/hips\/([a-z0-9]{1,12})\//.exec(path);
  const layer = m0?.[1];
  if (!layer || !(layer in HIPS_LAYERS)) return null;
  const rest = path.slice(m0[0].length);
  if (rest === 'properties') return { layer, kind: 'properties' };
  const m = /^Norder(\d{1,2})\/Dir(\d+)\/Npix(\d+)\.eph$/.exec(rest);
  if (!m) return null;
  const order = Number(m[1]);
  const dir = Number(m[2]);
  const pix = Number(m[3]);
  if (order > 11 || pix >= 12 * 4 ** order || dir !== Math.floor(pix / 10000) * 10000) return null;
  return { layer, kind: 'tile', order, pix };
}

/**
 * HEALPix (order, nested pix) → a PMTiles z/x/y. Order o has 12·4^o pixels,
 * which fit in zoom z = o + 2 (4^(o+2) = 16·4^o slots): x = pix mod 2^z,
 * y = pix div 2^z. The pipeline uses the same mapping.
 */
export function hipsToTile(order: number, pix: number): { z: number; x: number; y: number } {
  const z = order + 2;
  const n = 2 ** z;
  return { z, x: pix % n, y: Math.floor(pix / n) };
}

/** Only Copernicus GLO-30 COG names, e.g. Copernicus_DSM_COG_10_N42_00_E000_00_DEM. */
export function parseDem(path: string): string | null {
  const m = /^\/dem\/(Copernicus_DSM_COG_10_[NS]\d{2}_00_[EW]\d{3}_00_DEM)\/\1\.tif$/.exec(path);
  return m ? (m[1] ?? null) : null;
}

/** Largest DEM byte slice the Worker will fetch in one request. */
export const DEM_MAX_SLICE = 4 * 1024 * 1024;

/**
 * The byte slice of a DEM request, from the `r=<start>-<end>` query parameter
 * (inclusive, like HTTP ranges). The range travels in the URL rather than a
 * Range header because Workers Caching strips Range headers and caches by URL:
 * this way each slice is its own cacheable URL.
 */
export function parseDemSlice(search: string): { start: number; end: number } | null {
  const r = new URLSearchParams(search).get('r');
  const m = r ? /^(\d{1,10})-(\d{1,10})$/.exec(r) : null;
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (end < start || end - start + 1 > DEM_MAX_SLICE) return null;
  return { start, end };
}

/** /7timer/42.9/0.1 — coordinates rounded to 0.1° (7Timer!'s grid is coarser). */
export function parse7timer(path: string): { lat: string; lon: string } | null {
  const m = /^\/7timer\/(-?\d{1,2}(?:\.\d)?)\/(-?\d{1,3}(?:\.\d)?)$/.exec(path);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat: lat.toFixed(1), lon: lon.toFixed(1) };
}

/** /aq/12.97/77.59 — measured air quality near a point; coordinates rounded to 0.01°. */
export function parseAq(path: string): { lat: number; lon: number } | null {
  const m = /^\/aq\/(-?\d{1,2}(?:\.\d{1,2})?)\/(-?\d{1,3}(?:\.\d{1,2})?)$/.exec(path);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 };
}

/**
 * EPA NowCast concentration for PM (AirNow Technical Document, 2019): hourly
 * values newest first (null = missing). Weight factor w = min/max over the last
 * 12 hours, floored at 0.5; NowCast = Σ wⁱcᵢ / Σ wⁱ. Needs at least two of the
 * three most recent hours, else null.
 */
export function nowCast(hours: readonly (number | null)[]): number | null {
  const c = hours.slice(0, 12);
  const recent = c.slice(0, 3).filter((v) => v != null && Number.isFinite(v));
  if (recent.length < 2) return null;
  const vals = c.filter((v): v is number => v != null && Number.isFinite(v) && v >= 0);
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const w = max > 0 ? Math.max(0.5, min / max) : 1;
  let num = 0;
  let den = 0;
  c.forEach((v, i) => {
    if (v == null || !Number.isFinite(v) || v < 0) return;
    num += w ** i * v;
    den += w ** i;
  });
  return den > 0 ? num / den : null;
}

/** Great-circle distance in km. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Hourly values (any order; `end` = end of the hour, ms) → a newest-first series
 * of `n` hours (default 12) counted back from the newest hour reported, plus that hour's end.
 */
export function hourlySeries(
  rows: readonly { value: number | null; end: number }[],
  n = 12,
): {
  series: (number | null)[];
  newest: number | null;
} {
  const valid = rows.filter(
    (r): r is { value: number; end: number } =>
      r.value != null && Number.isFinite(r.value) && r.value >= 0 && Number.isFinite(r.end),
  );
  if (!valid.length) return { series: [], newest: null };
  const newest = Math.max(...valid.map((r) => r.end));
  const series = new Array<number | null>(n).fill(null);
  for (const r of valid) {
    const i = Math.round((newest - r.end) / 3600_000);
    if (i >= 0 && i < n && series[i] == null) series[i] = r.value;
  }
  return { series, newest };
}

/**
 * Mean of the newest `hours` values of a newest-first series, or null when fewer than
 * `minValid` of them are present (the EPA's 75 % completeness: 6 of 8 hours, 18 of 24).
 */
export function trailingMean(
  series: readonly (number | null)[],
  hours: number,
  minValid = Math.ceil(hours * 0.75),
): number | null {
  const v = series.slice(0, hours).filter((x): x is number => x != null && Number.isFinite(x));
  return v.length >= minValid && v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Gases read per place, as OpenAQ names them. */
export const AQ_GASES = ['o3', 'no2', 'so2', 'co'] as const;
export type AqGas = (typeof AQ_GASES)[number];
const MOLAR_MASS: Record<AqGas, number> = { o3: 48.0, no2: 46.0055, so2: 64.066, co: 28.01 };

/**
 * A gas value in the sensor's own unit (OpenAQ: µg/m³ for e.g. India's CPCB, ppm for US
 * AirNow) → ppb for O3/NO2/SO2 and ppm for CO, the units of the EPA AQI table, using the EPA
 * reference state (25 °C, 1 atm: 24.45 L/mol). Null for a unit we do not know.
 */
export function gasToStd(value: number, unit: string, gas: AqGas): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const u = unit.toLowerCase().replace(/\s/g, '').replace('μ', 'µ').replace(/^u/, 'µ');
  const ugm3 = u === 'µg/m³' || u === 'µg/m3';
  const mgm3 = u === 'mg/m³' || u === 'mg/m3';
  let ppb: number;
  if (u === 'ppb') ppb = value;
  else if (u === 'ppm') ppb = value * 1000;
  else if (ugm3) ppb = (value * 24.45) / MOLAR_MASS[gas];
  else if (mgm3) ppb = (value * 1000 * 24.45) / MOLAR_MASS[gas];
  else return null;
  return gas === 'co' ? ppb / 1000 : ppb;
}

/** Search box (OpenAQ `bbox`: minLon,minLat,maxLon,maxLat) reaching `km` from a point. */
export function bboxAround(lat: number, lon: number, km: number): string {
  const dLat = km / 111.2;
  const dLon = km / (111.2 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  const f = (x: number) => x.toFixed(4);
  return [
    f(Math.max(-180, lon - dLon)),
    f(Math.max(-90, lat - dLat)),
    f(Math.min(180, lon + dLon)),
    f(Math.min(90, lat + dLat)),
  ].join(',');
}

/** Round a series for the response (one decimal; three for ppm). */
export const roundSeries = (s: readonly (number | null)[], d = 1) =>
  s.map((x) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d));

export const OPENAQ = 'https://api.openaq.org/v3';
/** Stations further than this are not "at the site". */
export const AQ_RADIUS_M = 25_000;
/** Readings older than this are not current. */
export const AQ_MAX_AGE_MS = 3 * 3600_000;
/** Monitors read per place (some report only PM10, or nothing in the last hours). */
export const AQ_STATIONS = 5;
/**
 * Monitors read per request: the nearest ones often report only PM10 or have a stale PM2.5
 * sensor (Bangalore 20 Nov 2026: 1 of the 5 nearest had PM2.5), so more are read and those
 * with a recent PM2.5 hour are kept first. 8 × 2 sensor reads per 20-minute cache miss.
 */
export const AQ_READ = 8;
/**
 * When no monitor reports within AQ_RADIUS_M (most dark sites), the nearest few within this
 * distance are read for reference. They are shown apart and never set the site's figure.
 */
export const AQ_REGIONAL_KM = 100;
export const AQ_REGIONAL_STATIONS = 3;
/** Hours of history read per sensor: the 24-hour means and the chart need a full day. */
export const AQ_HOURS = 24;

/** GitHub repository whose workflows the Worker's cron starts. */
export const GH_REPO = 'aditadi2001-creator/astro-night-planning-live';

/**
 * Cron schedule → workflow to start. GitHub's own schedule for these jobs is
 * unreliable (it never fired in this repo's first hours), so the Worker's
 * Cron Trigger starts them through the official workflow_dispatch API too.
 * The jobs skip work that is already done, so a double start is harmless.
 */
export const CRON_WORKFLOWS: Record<string, string> = {
  '47 * * * *': 'clouds-hourly.yml',
};

export function workflowForCron(cron: string): string | null {
  return CRON_WORKFLOWS[cron] ?? null;
}

export function dispatchRequest(workflow: string, token: string): [string, RequestInit] {
  return [
    `https://api.github.com/repos/${GH_REPO}/actions/workflows/${workflow}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'astro-night-planning-live-cron',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main' }),
    },
  ];
}

export function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, If-None-Match',
    'Access-Control-Expose-Headers':
      'Content-Range, Accept-Ranges, Content-Length, ETag, X-File-Size',
    // Lets the site's budget probe see transfer sizes and cache hits (no data is exposed).
    'Timing-Allow-Origin': '*',
  };
}
