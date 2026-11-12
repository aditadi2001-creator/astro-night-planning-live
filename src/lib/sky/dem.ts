/**
 * Copernicus DEM GLO-30 reader for the terrain horizon.
 *
 * Data: Copernicus DEM GLO-30 (public), 1°×1° cloud-optimised GeoTIFFs on AWS
 * Open Data. Licence: free of charge for any use with the notice
 * "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus
 * Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European
 * Union and ESA; all rights reserved" (see Credits). Nothing is stored by us:
 * the browser reads only the few blocks it needs with HTTP range requests.
 *
 * The bucket sends no CORS headers, so browsers read it through our Worker
 * (`VITE_DEM_BASE`); in development the Vite dev server proxies `/dem`.
 *
 * We read only overview level 3 (≈ 240 m) of each 1°×1° tile within 90 km:
 * one header and one ~0.6 MB block per tile, typically 4–6 tiles (8–12
 * requests, 2.5–4 MB) per new location. The resulting profile is cached on
 * the device, so a location is only fetched once. 240 m is enough for terrain
 * beyond the first 300 m, which is all the horizon needs.
 */
import { fromUrl, type GeoTIFFImage } from 'geotiff';
import { horizonProfile } from './horizon';

export const DEM_BASE: string =
  (import.meta.env.VITE_DEM_BASE as string | undefined) ?? (import.meta.env.DEV ? '/dem' : '');

const FAR_M = 90_000;
const M_PER_DEG = 111_320;
const CACHE_PREFIX = 'anp.horizon.v2.';

interface Raster {
  west: number;
  north: number;
  /** Degrees per pixel. */
  dx: number;
  dy: number;
  w: number;
  h: number;
  data: Float32Array | null; // null = no tile (sea)
}

function tileName(latFloor: number, lonFloor: number): string {
  const ns = latFloor >= 0 ? 'N' : 'S';
  const ew = lonFloor >= 0 ? 'E' : 'W';
  const la = String(Math.abs(latFloor)).padStart(2, '0');
  const lo = String(Math.abs(lonFloor)).padStart(3, '0');
  return `Copernicus_DSM_COG_10_${ns}${la}_00_${ew}${lo}_00_DEM`;
}

async function openTile(latFloor: number, lonFloor: number, signal: AbortSignal) {
  const name = tileName(latFloor, lonFloor);
  try {
    // 64 KiB blocks: the whole COG header arrives in one request. `blockSize`
    // is a supported BlockedSource option that the bundled typings omit.
    const opts = { blockSize: 65_536 } as unknown as Parameters<typeof fromUrl>[1];
    const tiff = await fromUrl(`${DEM_BASE}/${name}/${name}.tif`, opts, signal);
    return tiff;
  } catch (e) {
    if (signal.aborted) throw e;
    return null; // missing tile = open sea (Copernicus has no ocean tiles)
  }
}

async function readImage(
  img: GeoTIFFImage,
  latFloor: number,
  lonFloor: number,
  window: [number, number, number, number] | null,
  signal: AbortSignal,
): Promise<Raster> {
  const W = img.getWidth();
  const H = img.getHeight();
  const dx = 1 / W;
  const dy = 1 / H;
  const [x0, y0, x1, y1] = window ?? [0, 0, W, H];
  const r = (await img.readRasters({
    window: [x0, y0, x1, y1],
    interleave: true,
    signal,
  })) as unknown as Float32Array | number[];
  return {
    west: lonFloor + x0 * dx,
    north: latFloor + 1 - y0 * dy,
    dx,
    dy,
    w: x1 - x0,
    h: y1 - y0,
    data: r instanceof Float32Array ? r : Float32Array.from(r),
  };
}

function sampleRaster(r: Raster, lat: number, lon: number): number {
  if (!r.data) return 0;
  const x = (lon - r.west) / r.dx - 0.5;
  const y = (r.north - lat) / r.dy - 0.5;
  if (x < 0 || y < 0 || x > r.w - 1 || y > r.h - 1) return Number.NaN;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const at = (i: number, j: number) =>
    r.data?.[Math.min(r.h - 1, j) * r.w + Math.min(r.w - 1, i)] ?? 0;
  return (
    at(ix, iy) * (1 - fx) * (1 - fy) +
    at(ix + 1, iy) * fx * (1 - fy) +
    at(ix, iy + 1) * (1 - fx) * fy +
    at(ix + 1, iy + 1) * fx * fy
  );
}

export interface SiteHorizon {
  profile: Float32Array;
  /** Ground elevation at the site from the DEM (m). */
  siteElevation: number;
  /** Number of DEM tiles that existed (0 = all sea / unavailable). */
  tiles: number;
}

function cacheKey(lat: number, lon: number, eye: number | null) {
  return `${CACHE_PREFIX}${lat.toFixed(3)},${lon.toFixed(3)},${eye == null ? 'dem' : Math.round(eye)}`;
}

function readCache(lat: number, lon: number, eye: number | null): SiteHorizon | null {
  try {
    const raw = localStorage.getItem(cacheKey(lat, lon, eye));
    if (!raw) return null;
    const v = JSON.parse(raw) as { p: number[]; e: number; n: number };
    return { profile: Float32Array.from(v.p, (x) => x / 100), siteElevation: v.e, tiles: v.n };
  } catch {
    return null;
  }
}

function writeCache(lat: number, lon: number, eye: number | null, h: SiteHorizon) {
  try {
    localStorage.setItem(
      cacheKey(lat, lon, eye),
      JSON.stringify({
        p: Array.from(h.profile, (x) => Math.round(x * 100)),
        e: h.siteElevation,
        n: h.tiles,
      }),
    );
  } catch {
    /* storage full: recompute next time */
  }
}

/** True when the browser asks us to save data (Data Saver, 2G/3G). */
export function shouldSaveData(): boolean {
  const c = (
    navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
  ).connection;
  return !!c && (c.saveData === true || /(^|-)(2g|3g)$/.test(c.effectiveType ?? ''));
}

export function hasCachedHorizon(lat: number, lon: number, siteElevation: number | null): boolean {
  return readCache(lat, lon, siteElevation) !== null;
}

/**
 * Compute (or load from cache) the apparent terrain horizon around a site.
 *
 * `siteElevation` is the observer's ground elevation when known (geocoder or
 * GPS): at 240 m resolution the DEM flattens sharp summits and ridges, so a
 * known elevation is more accurate for the eye height. Without it we use the
 * DEM value at the exact spot.
 */
export async function loadHorizon(
  lat: number,
  lon: number,
  siteElevation: number | null,
  signal: AbortSignal,
): Promise<SiteHorizon | null> {
  if (!DEM_BASE) return null;
  const cached = readCache(lat, lon, siteElevation);
  if (cached) return cached;

  const cosLat = Math.cos((lat * Math.PI) / 180);
  const dLat = FAR_M / M_PER_DEG;
  const dLon = FAR_M / (M_PER_DEG * Math.max(0.05, cosLat));
  const far: Raster[] = [];
  let tiles = 0;
  const jobs: Promise<void>[] = [];
  for (let la = Math.floor(lat - dLat); la <= Math.floor(lat + dLat); la++) {
    for (let lo = Math.floor(lon - dLon); lo <= Math.floor(lon + dLon); lo++) {
      if (la < -90 || la > 89) continue;
      const lonW = ((((lo + 180) % 360) + 360) % 360) - 180;
      jobs.push(
        (async () => {
          const tiff = await openTile(la, lonW, signal);
          if (!tiff) {
            far.push({ west: lonW, north: la + 1, dx: 1, dy: 1, w: 1, h: 1, data: null });
            return;
          }
          tiles++;
          const count = await tiff.getImageCount();
          const farImg = await tiff.getImage(Math.min(3, count - 1));
          far.push(await readImage(farImg, la, lonW, null, signal));
        })(),
      );
    }
  }
  await Promise.all(jobs);
  if (!tiles) return { profile: new Float32Array(720).fill(0), siteElevation: 0, tiles: 0 };

  const sampleLatLon = (la: number, lo: number) => {
    for (const r of far) {
      const v = sampleRaster(r, la, lo);
      if (Number.isFinite(v)) return v;
      if (!r.data && la >= r.north - 1 && la < r.north && lo >= r.west && lo < r.west + 1) return 0;
    }
    return Number.NaN;
  };

  // Eye height: the known site elevation if we have one, else the DEM at the spot; + 1.7 m.
  const demHere = sampleLatLon(lat, lon);
  const siteGround =
    siteElevation != null && siteElevation > -500
      ? siteElevation
      : Number.isFinite(demHere)
        ? demHere
        : 0;
  const profile = horizonProfile(
    (e, n) => sampleLatLon(lat + n / M_PER_DEG, lon + e / (M_PER_DEG * cosLat)),
    siteGround + 1.7,
    { maxDistM: FAR_M },
  );
  const result = { profile, siteElevation: Math.round(siteGround), tiles };
  writeCache(lat, lon, siteElevation, result);
  return result;
}
