/**
 * Pure routing helpers for the data Worker (unit-tested in tests/worker-routes.test.ts).
 * Every route is a strict allow-list so the Worker can never be used as an
 * open proxy or to read arbitrary objects from the bucket.
 */

export type DatasetRef =
  | { kind: 'lightpollution'; year: number } // modelled sky brightness, zoom 0–8
  | { kind: 'lprad'; year: number } // night-lights radiance for light domes, zoom 0–6
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
    /^\/tiles\/(lightpollution-(\d{4})|lprad-(\d{4})|clouds-(\d{10}))\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.(webp|png)$/.exec(
      path,
    );
  if (!m) return null;
  const z = Number(m[5]);
  const x = Number(m[6]);
  const y = Number(m[7]);
  if (z > 16 || x >= 2 ** z || y >= 2 ** z) return null;
  const dataset: DatasetRef = m[2]
    ? { kind: 'lightpollution', year: Number(m[2]) }
    : m[3]
      ? { kind: 'lprad', year: Number(m[3]) }
      : { kind: 'clouds', hour: m[4] ?? '' };
  return { dataset, z, x, y };
}

export type HipsRef = { kind: 'properties' } | { kind: 'tile'; order: number; pix: number };

/** /hips/gaia/properties or /hips/gaia/Norder5/Dir10000/Npix12345.eph */
export function parseHips(path: string): HipsRef | null {
  if (path === '/hips/gaia/properties') return { kind: 'properties' };
  const m = /^\/hips\/gaia\/Norder(\d{1,2})\/Dir(\d+)\/Npix(\d+)\.eph$/.exec(path);
  if (!m) return null;
  const order = Number(m[1]);
  const dir = Number(m[2]);
  const pix = Number(m[3]);
  if (order > 11 || pix >= 12 * 4 ** order || dir !== Math.floor(pix / 10000) * 10000) return null;
  return { kind: 'tile', order, pix };
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

export function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, If-None-Match',
    'Access-Control-Expose-Headers':
      'Content-Range, Accept-Ranges, Content-Length, ETag, X-File-Size',
  };
}
