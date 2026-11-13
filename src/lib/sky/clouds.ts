/**
 * Cloud layer texture for the sky view.
 *
 * Data, not decoration: the cloud *amount* everywhere comes from the forecast
 * (Open-Meteo low/mid/high cloud cover at the site and at 16 points 35 km and
 * 100 km away in 8 directions). Procedural noise only decides *where* inside
 * that area the cloud sits, and is thresholded so the covered fraction equals
 * the forecast fraction.
 *
 * Geometry: each layer is a spherical shell at a typical base height (low
 * 1.5 km, mid 4.5 km, high 9 km). A line of sight at altitude a meets the
 * shell at ground distance d(a), so clouds near the horizon are far away and
 * take their cover from the outer ring in that direction. Layers drift with
 * the forecast wind at 850 / 500 / 250 hPa. High cloud is drawn thin and
 * streaky along the upper wind; low cloud thick and opaque.
 *
 * Output: RGBA, width = azimuth 0–360° from north (eastwards), rows from
 * altitude 0° (first row) to 90°.
 */

import { domeAt } from './horizon';

export interface CloudSample {
  /** Bearing from the site, degrees from north. */
  az: number;
  /** Distance from the site, km. */
  dist: number;
  low: number;
  mid: number;
  high: number;
}

export interface LayerWind {
  /** km/h */
  speed: number;
  /** Meteorological direction the wind comes FROM, degrees. */
  dir: number;
}

export type Rgb = [number, number, number];

export interface CloudInput {
  center: { low: number; mid: number; high: number };
  /** 8 directions × rings, any order. */
  samples: CloudSample[];
  wind: { low: LayerWind; mid: LayerWind; high: LayerWind };
  /** Seconds since an arbitrary epoch, for drift. */
  time: number;
  /** Display colours of cloud bases per layer (sRGB 0–255). */
  color: { low: Rgb; mid: Rgb; high: Rgb };
  width: number;
  height: number;
  /**
   * Real cloud field from the satellite (sat/field.ts): brightness temperatures
   * on a grid around the site, the surface temperature, the satellite's weight
   * (0–1, fading with the image's age) and that age in seconds (clouds drift
   * with the layer winds over it).
   */
  field?: {
    n: number;
    stepKm: number;
    bt: Float32Array;
    surfaceK: number;
    weight: number;
    ageS: number;
  } | null;
  /**
   * Artificial sky glow behind the clouds: colour and zenith opacity (0–1), plus
   * optional light domes per 10° of azimuth from north (artificial / natural
   * brightness near the horizon) with the site's zenith ratio, so towns rise
   * towards their real directions and fade with altitude.
   */
  glow?: {
    rgb: Rgb;
    zenithA: number;
    domes?: readonly number[];
    zenithRatio?: number;
  } | null;
}

/** Cloud tops cool at the standard lapse rate (K per km). */
export const LAPSE_K_PER_KM = 6.5;

/** Share of a cloud with this top height (km) that belongs to each layer (low/mid/high). */
export function layerShare(topKm: number): [number, number, number] {
  const ramp = (x: number, a: number, b: number) => Math.min(1, Math.max(0, (x - a) / (b - a)));
  const aboveLow = ramp(topKm, 2.5, 3.5);
  const aboveMid = ramp(topKm, 6.25, 7.75);
  return [1 - aboveLow, aboveLow * (1 - aboveMid), aboveMid];
}

/** Brightness temperature (K) → cloud fraction (0–1) and top height (km). */
export function cellCloud(btK: number, surfaceK: number): { frac: number; topKm: number } {
  const frac = Math.min(1, Math.max(0, (surfaceK - 8 - btK) / 12));
  return { frac, topKm: Math.max(0, (surfaceK - btK) / LAPSE_K_PER_KM) };
}

const R_EARTH = 6371;
export const LAYERS = [
  { key: 'low', heightKm: 1.5, scaleKm: 1.2, opacity: 0.97, soft: 0.05, stretch: 1 },
  { key: 'mid', heightKm: 4.5, scaleKm: 3, opacity: 0.9, soft: 0.07, stretch: 1.6 },
  { key: 'high', heightKm: 9, scaleKm: 6, opacity: 0.4, soft: 0.12, stretch: 4 },
] as const;
type LayerKey = (typeof LAYERS)[number]['key'];

/** Ground distance (km) at which a line of sight at altitude `altDeg` meets a shell `h` km up. */
export function groundDistance(altDeg: number, hKm: number): number {
  const a = (altDeg * Math.PI) / 180;
  const r = R_EARTH;
  // Slant range s from the law of cosines; ground distance = R × central angle.
  const s = Math.sqrt((r + hKm) ** 2 - (r * Math.cos(a)) ** 2) - r * Math.sin(a);
  const central = Math.asin((s * Math.cos(a)) / (r + hKm));
  return r * central;
}

// ---------------------------------------------------------------- noise
function hash(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Fractal noise in [0,1]; `octaves` may be fractional to fade detail with distance. */
export function fbm(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  const full = Math.floor(octaves);
  for (let o = 0; o < Math.ceil(octaves); o++) {
    const w = o < full ? 1 : octaves - full;
    sum += amp * w * valueNoise(x * f, y * f, seed + o * 17);
    norm += amp * w;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/** Quantile table of fbm values so a coverage fraction maps to a threshold. */
function quantiles(seed: number, octaves: number): Float32Array {
  const n = 4096;
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++)
    v[i] = fbm(hash(i, 1, seed) * 1000, hash(i, 2, seed) * 1000, seed, octaves);
  v.sort();
  return v;
}

const qCache = new Map<string, Float32Array>();
function quantileTable(seed: number, octaves: number): Float32Array {
  const key = `${seed}:${octaves}`;
  let q = qCache.get(key);
  if (!q) {
    q = quantiles(seed, octaves);
    qCache.set(key, q);
  }
  return q;
}

// ---------------------------------------------------------------- coverage field
function ringValue(samples: CloudSample[], ring: number, az: number, key: LayerKey): number {
  const pts = samples.filter((s) => Math.abs(s.dist - ring) < 1).sort((a, b) => a.az - b.az);
  if (!pts.length) return Number.NaN;
  const n = pts.length;
  const step = 360 / n;
  const pos = (((az % 360) + 360) % 360) / step;
  const i0 = Math.floor(pos) % n;
  const i1 = (i0 + 1) % n;
  const t = pos - Math.floor(pos);
  return (pts[i0]?.[key] ?? 0) * (1 - t) + (pts[i1]?.[key] ?? 0) * t;
}

/** Forecast cover (0–1) at bearing `az`, distance `d` km, interpolated between site and rings. */
export function coverAt(input: CloudInput, key: LayerKey, az: number, d: number): number {
  const rings = [...new Set(input.samples.map((s) => Math.round(s.dist)))].sort((a, b) => a - b);
  let prevD = 0;
  let prevV = input.center[key];
  for (const r of rings) {
    const v = ringValue(input.samples, r, az, key);
    if (!Number.isFinite(v)) continue;
    if (d <= r) {
      const t = (d - prevD) / (r - prevD);
      return (prevV * (1 - t) + v * t) / 100;
    }
    prevD = r;
    prevV = v;
  }
  return prevV / 100;
}

// ---------------------------------------------------------------- texture
export function renderClouds(input: CloudInput): Uint8ClampedArray {
  const { width: w, height: h } = input;
  const out = new Uint8ClampedArray(w * h * 4);
  const seeds = { low: 11, mid: 23, high: 37 };
  const layerState = LAYERS.map((L) => {
    const wind = input.wind[L.key];
    // Drift: wind blows FROM `dir`, so clouds move towards dir + 180°.
    const to = ((wind.dir + 180) * Math.PI) / 180;
    const km = (wind.speed * input.time) / 3600;
    return {
      ...L,
      seed: seeds[L.key],
      dx: Math.sin(to) * km,
      dy: Math.cos(to) * km,
      // Streak direction for anisotropic (cirrus) texture.
      ca: Math.cos(to),
      sa: Math.sin(to),
      color: input.color[L.key],
    };
  });

  // Per-column precomputation: bearing trig and ring cover for each layer.
  const rings = [...new Set(input.samples.map((s) => Math.round(s.dist)))].sort((a, b) => a - b);
  const sinCol = new Float32Array(w);
  const cosCol = new Float32Array(w);
  const azCol = new Float32Array(w);
  for (let i = 0; i < w; i++) {
    const az = ((i + 0.5) / w) * 360;
    azCol[i] = az;
    sinCol[i] = Math.sin((az * Math.PI) / 180);
    cosCol[i] = Math.cos((az * Math.PI) / 180);
  }
  const ringCols = layerState.map((L) =>
    rings.map((r) => {
      const col = new Float32Array(w);
      for (let i = 0; i < w; i++) col[i] = ringValue(input.samples, r, azCol[i] ?? 0, L.key);
      return col;
    }),
  );
  // Satellite field sampling (bilinear), shifted by each layer's drift since the image.
  const F = input.field && input.field.weight > 0.01 ? input.field : null;
  const fieldShift = layerState.map((L) => {
    if (!F) return { x: 0, y: 0 };
    const wind = input.wind[L.key];
    const to = ((wind.dir + 180) * Math.PI) / 180;
    const km = (wind.speed * F.ageS) / 3600;
    return { x: Math.sin(to) * km, y: Math.cos(to) * km };
  });
  const fieldCover = (l: number, x: number, y: number): number => {
    if (!F) return Number.NaN;
    const sh = fieldShift[l] ?? { x: 0, y: 0 };
    const c = (F.n - 1) / 2;
    const fx = (x - sh.x) / F.stepKm + c;
    const fy = (y - sh.y) / F.stepKm + c;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    if (ix < 0 || iy < 0 || ix >= F.n - 1 || iy >= F.n - 1) return Number.NaN;
    const tx = fx - ix;
    const ty = fy - iy;
    const at = (a: number, b: number) => F.bt[b * F.n + a] ?? Number.NaN;
    const v00 = at(ix, iy);
    const v10 = at(ix + 1, iy);
    const v01 = at(ix, iy + 1);
    const v11 = at(ix + 1, iy + 1);
    const bt = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
    if (!Number.isFinite(bt)) return Number.NaN;
    const { frac, topKm } = cellCloud(bt, F.surfaceK);
    return frac * (layerShare(topKm)[l] ?? 0);
  };

  const coverFast = (l: number, i: number, d: number, center: number): number => {
    let prevD = 0;
    let prevV = center;
    const cols = ringCols[l] ?? [];
    for (let k = 0; k < rings.length; k++) {
      const r = rings[k] ?? 0;
      const v = cols[k]?.[i] ?? Number.NaN;
      if (!Number.isFinite(v)) continue;
      if (d <= r) {
        const t = (d - prevD) / (r - prevD);
        return (prevV * (1 - t) + v * t) / 100;
      }
      prevD = r;
      prevV = v;
    }
    return prevV / 100;
  };

  const gz = input.glow?.zenithA ?? 0;
  const gRgb: Rgb = input.glow?.rgb ?? [0, 0, 0];
  const rowGlow = new Float32Array(h);
  for (let j = 0; j < h; j++) {
    const s = Math.sin((Math.max(0.5, ((j + 0.5) / h) * 90) * Math.PI) / 180);
    rowGlow[j] = Math.min(2.2, 1 / Math.sqrt(Math.max(0.03, s)));
  }
  // Light domes: contrast of each direction against the local sky, fading with
  // altitude as e^(−alt/12°) (light scattered from towns tens of km away).
  const domes = input.glow?.domes ?? [];
  const colDome = new Float32Array(w);
  const rowDome = new Float32Array(h);
  if (gz > 0 && domes.length) {
    const minD = Math.min(...domes);
    const R = Math.max(0, input.glow?.zenithRatio ?? 0);
    for (let i = 0; i < w; i++) {
      const e = (domeAt(domes, ((i + 0.5) / w) * 360) - minD) / (1 + R);
      colDome[i] = Math.min(0.45, 0.11 * Math.log1p(Math.max(0, e)));
    }
    for (let j = 0; j < h; j++) rowDome[j] = Math.exp(-(((j + 0.5) / h) * 90) / 12);
  }

  for (let j = 0; j < h; j++) {
    const alt = Math.max(0.3, ((j + 0.5) / h) * 90);
    // Per-row precomputation: distance, octave count and threshold table per layer.
    const rowState = layerState.map((L) => {
      const d = groundDistance(alt, L.heightKm);
      // Fewer octaves far away: avoids aliasing where a pixel spans kilometres.
      const octaves = Math.max(1.5, Math.min(5, 5 - Math.log2(1 + d / (L.scaleKm * 6))));
      const qOct = Math.round(octaves * 2) / 2;
      return { d, octaves, table: quantileTable(L.seed, qOct) };
    });
    for (let i = 0; i < w; i++) {
      const sinA = sinCol[i] ?? 0;
      const cosA = cosCol[i] ?? 1;
      // Composite front (low) to back (high).
      let r = 0;
      let g = 0;
      let b = 0;
      let transmit = 1;
      for (let l = 0; l < layerState.length; l++) {
        const L = layerState[l];
        const R = rowState[l];
        if (!L || !R) continue;
        let cover = coverFast(l, i, R.d, input.center[L.key]);
        if (F) {
          // Real clouds where the satellite saw them, blended by the image's weight.
          const fc = fieldCover(l, R.d * sinA, R.d * cosA);
          if (Number.isFinite(fc)) cover = F.weight * fc + (1 - F.weight) * cover;
        }
        if (cover <= 0.001) continue;
        // Offset by an arbitrary 731/198 noise cells so the site never sits on the lattice origin.
        const x = (R.d * sinA - L.dx) / L.scaleKm + 731.37;
        const y = (R.d * cosA - L.dy) / L.scaleKm + 197.91;
        // Rotate into the wind frame and stretch along it.
        const u = (x * L.ca + y * L.sa) / L.stretch;
        const v = -x * L.sa + y * L.ca;
        const n = fbm(u, v, L.seed, R.octaves);
        const q = R.table;
        const t =
          q[Math.min(q.length - 1, Math.max(0, Math.round((1 - cover) * (q.length - 1))))] ?? 0.5;
        const dens = smoothstep(t - L.soft, t + L.soft, n);
        const a = dens * L.opacity;
        if (a <= 0) continue;
        r += transmit * a * L.color[0];
        g += transmit * a * L.color[1];
        b += transmit * a * L.color[2];
        transmit *= 1 - a;
      }
      // Artificial sky glow behind the clouds, brighter towards the horizon
      // (path length through lit air; roughly 1/√sin(alt), capped).
      if (gz > 0) {
        const ga = Math.min(0.85, gz * (rowGlow[j] ?? 1) + (colDome[i] ?? 0) * (rowDome[j] ?? 0));
        r += transmit * ga * gRgb[0];
        g += transmit * ga * gRgb[1];
        b += transmit * ga * gRgb[2];
        transmit *= 1 - ga;
      }
      const alpha = 1 - transmit;
      const k = (j * w + i) * 4;
      if (alpha > 0) {
        out[k] = r / alpha;
        out[k + 1] = g / alpha;
        out[k + 2] = b / alpha;
      }
      out[k + 3] = alpha * 255;
    }
  }
  return out;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Cloud-base colours for the current lighting. Daylight: grey-white bases.
 * Night: clouds block the sky and look darker than it, unless moonlit or lit
 * from below by artificial light (orange, scaled by `glow` 0–1 from the
 * light-pollution layer).
 */
export function cloudColors(sunAlt: number, moonAlt: number, moonIllum: number, glow = 0) {
  const day = Math.min(1, Math.max(0, (sunAlt + 12) / 18)); // 0 at −12°, 1 at +6°
  const moon = moonAlt > 0 ? moonIllum * Math.min(1, Math.sin((moonAlt * Math.PI) / 180) * 2) : 0;
  const lerp = (a: Rgb, b: Rgb, t: number): Rgb => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
  const night: Rgb = [6, 7, 9];
  const moonlit: Rgb = [58, 62, 70];
  // Cloud bases lit by city lights: a dim orange-grey, not a bright orange.
  const orange: Rgb = [104, 80, 62];
  const base = (dayRgb: Rgb, glowShare: number): Rgb => {
    let c = lerp(night, moonlit, moon * 0.8);
    c = lerp(c, orange, Math.min(1, glow) * glowShare);
    return lerp(c, dayRgb, day);
  };
  return {
    low: base([168, 172, 180], 1),
    mid: base([198, 202, 210], 0.6),
    high: base([238, 240, 246], 0.25),
  };
}
