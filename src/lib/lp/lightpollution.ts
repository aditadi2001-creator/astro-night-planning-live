/**
 * Light pollution at the site, from the yearly map built by
 * pipelines/lightpollution (NASA Black Marble VNP46A4 night lights → a
 * Garstang / Cinzano–Falchi style sky-glow model calibrated on Globe at Night
 * SQM readings). Yearly, not live; satellites under-count blue/white LED
 * light, so real skies may be brighter. Both are said in the UI.
 *
 * - Zenith brightness: one zoom-8 tile of the `lightpollution-<year>` layer
 *   (grey/40 = mag brighter than the natural 22.0 mag/arcsec²).
 * - Light domes: the `lprad-<year>` night-lights layer (zoom 6, ~2 km) within
 *   150 km, summed per 10° of azimuth with the same fitted kernel, one power
 *   of distance flatter (a line of sight towards a town runs over it, so
 *   horizon glow falls off more slowly than zenith glow). Drawn relative to
 *   the zenith value: approximate, for the picture, not for measurement.
 */
import { DATA_BASE } from '../config';
import { fetchJson, type Cached } from '../data/cache';
import { decodeTile, pixelCenter, pixelFor } from '../data/tiles';
import { DIST_BINS, distBin, weightedHaze } from '../physics/hazeglow';

export interface LpModel {
  p: number;
  d0Km: number;
  DKm: number;
  A: number;
  rMaxKm: number;
}

export interface LpInfo {
  year: number;
  naturalSqm: number;
  model: LpModel;
  lp: { tiles: string; maxzoom: number; magPerStep: number };
  rad: { tiles: string; maxzoom: number; scale: number; ref: number };
  validation?: {
    best?: { n?: number; median_abs_mag?: number; rms_mag_without_outliers?: number };
  };
}

/**
 * Yearly model description. A copy for the current model year ships with the site
 * (public/data/, no data-Worker request); the Worker's copy is the fallback, e.g. right
 * after a new yearly model is published and before the site is rebuilt.
 */
export const LP_INFO_URL = DATA_BASE ? `${DATA_BASE}/data/lightpollution.json` : '';
const LP_INFO_STATIC = `${import.meta.env.BASE_URL}data/lightpollution-2025.json`;

// Commonly quoted SQM boundaries of the (visual) Bortle scale; approximate.
const BORTLE_LIMITS: [number, number][] = [
  [21.99, 1],
  [21.89, 2],
  [21.69, 3],
  [20.49, 4],
  [19.5, 5],
  [18.94, 6],
  [18.38, 7],
  [17.8, 8],
];

export const BORTLE_LABELS: Record<number, string> = {
  1: 'excellent dark-sky site',
  2: 'truly dark site',
  3: 'rural sky',
  4: 'rural / suburban transition',
  5: 'suburban sky',
  6: 'bright suburban sky',
  7: 'suburban / urban transition',
  8: 'city sky',
  9: 'inner-city sky',
};

export function bortle(sqm: number): number {
  for (const [lim, b] of BORTLE_LIMITS) if (sqm >= lim) return b;
  return 9;
}

/** Zenith kernel of the model (same as pipelines/lightpollution/model.py). */
export function kernel(dKm: number, m: LpModel, flatter = 0): number {
  if (dKm > m.rMaxKm) return 0;
  return (dKm * dKm + m.d0Km * m.d0Km) ** (-(m.p - flatter) / 2) * Math.exp(-dKm / m.DKm);
}

export const SECTORS = 36;
/** Horizon glow relative to zenith glow when the lights surround the site evenly. */
export const HORIZON_GAIN = 2.5;

export interface LightPixel {
  lat: number;
  lon: number;
  /** Upward radiance, nW cm⁻² sr⁻¹. */
  L: number;
  areaKm2: number;
}

/**
 * Relative light-dome weights per 10° of azimuth (index 0 = north, clockwise),
 * normalised to a mean of 1; all zeros when there are no lights in range.
 */
export function domeWeights(pixels: readonly LightPixel[], lat: number, lon: number, m: LpModel) {
  const w = new Array<number>(SECTORS).fill(0);
  const kmLat = 111.195;
  const kmLon = kmLat * Math.cos((lat * Math.PI) / 180);
  for (const p of pixels) {
    let dLon = p.lon - lon;
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    const dx = dLon * kmLon;
    const dy = (p.lat - lat) * kmLat;
    const d = Math.hypot(dx, dy);
    if (d < 0.5 || d > m.rMaxKm) continue; // own pixel lights the whole sky, not one side
    const az = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    const s = Math.floor(az / (360 / SECTORS)) % SECTORS;
    w[s] = (w[s] ?? 0) + p.L * p.areaKm2 * kernel(d, m, 1);
  }
  const mean = w.reduce((a, b) => a + b, 0) / SECTORS;
  return mean > 0 ? w.map((x) => x / mean) : w;
}

/**
 * Where the site's light comes from, by distance (physics/hazeglow.ts bins):
 * `zenith[k]` = the zenith kernel's share from lights in bin k (own pixel in
 * bin 0); `domes[s * DIST_BINS + k]` = the dome kernel's share for sector s.
 * Lets the haze correction weigh near lights (brighter in haze) against far
 * ones (fainter) without reloading tiles.
 */
export function distanceWeights(
  pixels: readonly LightPixel[],
  lat: number,
  lon: number,
  m: LpModel,
) {
  const zenith = new Array<number>(DIST_BINS).fill(0);
  const domes = new Array<number>(SECTORS * DIST_BINS).fill(0);
  const kmLat = 111.195;
  const kmLon = kmLat * Math.cos((lat * Math.PI) / 180);
  for (const p of pixels) {
    let dLon = p.lon - lon;
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    const dx = dLon * kmLon;
    const dy = (p.lat - lat) * kmLat;
    const d = Math.hypot(dx, dy);
    if (d > m.rMaxKm) continue;
    const k = distBin(d);
    const e = p.L * p.areaKm2;
    zenith[k] = (zenith[k] ?? 0) + e * kernel(d, m);
    if (d < 0.5) continue;
    const az = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    const s = Math.floor(az / (360 / SECTORS)) % SECTORS;
    const i = s * DIST_BINS + k;
    domes[i] = (domes[i] ?? 0) + e * kernel(d, m, 1);
  }
  // Shares only; keep the cached copy small.
  const norm = (a: number[]) => {
    const t = a.reduce((x, y) => x + y, 0);
    return t > 0 ? a.map((x) => +(x / t).toPrecision(3)) : a;
  };
  return { zenith: norm(zenith), domes: norm(domes) };
}

export interface SiteLight {
  year: number;
  /**
   * Zenith sky brightness, mag/arcsec² (V, moonless, no twilight). As loaded it
   * assumes the 22.0 solar-minimum natural sky; withNaturalSky() adds today's.
   */
  sqm: number;
  /** Bortle class from the light pollution alone (against the 22.0 reference sky). */
  bortle: number;
  /** Magnitudes brighter than the 22.0 reference natural sky (light pollution only). */
  brightening: number;
  /** Artificial / natural zenith brightness. */
  ratio: number;
  /** Artificial / natural brightness near the horizon, per 10° of azimuth from north. */
  domes: number[];
  /** Typical model error vs. measurements, mag (from the validation). */
  typicalErrorMag: number | null;
  validationN: number | null;
  /** Natural sky used for `sqm` (mag/arcsec²). */
  naturalSqm: number;
  /** Shares of the zenith light by distance bin (absent in copies cached before haze). */
  zenithBins?: number[];
  /** Shares of the dome light by sector × distance bin. */
  domeBins?: number[];
  /** City-glow factor for tonight's haze applied to `sqm`, `ratio`, `domes` (1 = typical night). */
  haze?: number;
  /** AOD (550 nm) that `haze` was computed for. */
  hazeAod?: number;
}

export function siteFromBrightening(mag: number, natural = 22.0) {
  const ratio = 10 ** (mag / 2.5) - 1;
  const sqm = natural - mag;
  return { sqm, ratio, bortle: bortle(sqm) };
}

/**
 * The same site under today's natural sky (physics/airglow.ts): the artificial
 * light is unchanged, the natural part brightens with solar activity, so the
 * total brightens and the artificial/natural ratios (and domes) shrink. The
 * Bortle class stays the light-pollution class.
 */
export function withNaturalSky(light: SiteLight, naturalMag: number): SiteLight {
  // Copies cached before this field existed were all made against 22.0.
  const ref = (light.naturalSqm as number | undefined) ?? 22.0;
  const f = 10 ** (-0.4 * (naturalMag - ref));
  return {
    ...light,
    sqm: ref - 2.5 * Math.log10(f + light.ratio),
    ratio: light.ratio / f,
    domes: light.domes.map((d) => d / f),
    naturalSqm: naturalMag,
  };
}

/**
 * The yearly (typical-night) light pollution adjusted for one night's haze
 * (physics/hazeglow.ts): near lights brighten, far ones fade, each weighed by
 * how much of the site's light it gives. Call on the light as loaded, before
 * withNaturalSky(). Bortle and `brightening` stay the yearly values.
 */
export function withHaze(light: SiteLight, aod: number | null): SiteLight {
  if (aod == null || !light.zenithBins) return light;
  const zf = weightedHaze(light.zenithBins, aod);
  const ref = (light.naturalSqm as number | undefined) ?? 22.0;
  const ratio = light.ratio * zf;
  const db = light.domeBins;
  const domes = db
    ? light.domes.map((d, s) => d * weightedHaze(db.slice(s * DIST_BINS, (s + 1) * DIST_BINS), aod))
    : light.domes.map((d) => d * zf);
  return {
    ...light,
    ratio,
    sqm: ref - 2.5 * Math.log10(1 + ratio),
    domes,
    haze: zf,
    hazeAod: aod,
  };
}

const tileUrl = (tpl: string, z: number, x: number, y: number) =>
  DATA_BASE + tpl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));

export async function loadLpInfo(signal: AbortSignal, force = false): Promise<Cached<LpInfo>> {
  try {
    return await fetchJson<LpInfo>('lp.info', LP_INFO_STATIC, {
      maxAgeMs: force ? 0 : 24 * 3600_000,
      retries: 0,
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    return fetchJson<LpInfo>('lp.info.worker', LP_INFO_URL, {
      maxAgeMs: force ? 0 : 24 * 3600_000,
      signal,
    });
  }
}

async function siteBrightening(info: LpInfo, lat: number, lon: number, signal: AbortSignal) {
  const z = info.lp.maxzoom;
  const c = pixelFor(lat, lon, z);
  const img = await decodeTile(tileUrl(info.lp.tiles, z, c.tx, c.ty), signal);
  if (!img) return 0; // no tile: natural sky
  // Mean brightness (linear) over 3×3 pixels (~1.5 km), back to magnitudes.
  let sum = 0;
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = Math.min(255, Math.max(0, c.px + dx));
      const y = Math.min(255, Math.max(0, c.py + dy));
      const v = img.data[(y * 256 + x) * 4] ?? 0;
      sum += 10 ** ((v * info.lp.magPerStep) / 2.5);
      n++;
    }
  }
  return 2.5 * Math.log10(sum / n);
}

async function lightsAround(info: LpInfo, lat: number, lon: number, signal: AbortSignal) {
  const z = info.rad.maxzoom;
  const r = info.model.rMaxKm;
  const dLat = r / 111.195;
  const dLon = r / (111.195 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  const nw = pixelFor(Math.min(85, lat + dLat), lon - dLon, z);
  const se = pixelFor(Math.max(-85, lat - dLat), lon + dLon, z);
  const n = 2 ** z;
  const xs: number[] = [];
  for (let x = nw.tx; ; x = (x + 1) % n) {
    xs.push(x);
    if (x === se.tx || xs.length > 8) break;
  }
  const px: LightPixel[] = [];
  const kmPerPx = 40075.017 / (256 * n);
  for (let ty = nw.ty; ty <= se.ty; ty++) {
    for (const tx of xs) {
      const img = await decodeTile(tileUrl(info.rad.tiles, z, tx, ty), signal);
      if (!img) continue;
      for (let y = 0; y < 256; y++) {
        for (let x = 0; x < 256; x++) {
          const v = img.data[(y * 256 + x) * 4] ?? 0;
          if (!v) continue;
          const c = pixelCenter(z, tx, ty, x, y);
          const s = kmPerPx * Math.cos((c.lat * Math.PI) / 180);
          px.push({
            ...c,
            L: info.rad.ref * (10 ** (v / info.rad.scale) - 1),
            areaKm2: s * s,
          });
        }
      }
    }
  }
  return px;
}

/** Everything the app needs about light pollution at one place. */
export async function loadSiteLight(
  lat: number,
  lon: number,
  signal: AbortSignal,
  force = false,
): Promise<Cached<SiteLight>> {
  const info = await loadLpInfo(signal, force);
  const mag = await siteBrightening(info.data, lat, lon, signal);
  const q = siteFromBrightening(mag, info.data.naturalSqm);
  const pixels = await lightsAround(info.data, lat, lon, signal);
  const w = domeWeights(pixels, lat, lon, info.data.model);
  const dist = distanceWeights(pixels, lat, lon, info.data.model);
  const best = info.data.validation?.best;
  return {
    data: {
      year: info.data.year,
      ...q,
      brightening: mag,
      domes: w.map((x) => HORIZON_GAIN * q.ratio * x),
      typicalErrorMag: best?.median_abs_mag ?? null,
      validationN: best?.n ?? null,
      naturalSqm: info.data.naturalSqm,
      zenithBins: dist.zenith,
      domeBins: dist.domes,
    },
    fetchedAt: info.fetchedAt,
    ...(info.stale ? { stale: true } : {}),
  };
}
