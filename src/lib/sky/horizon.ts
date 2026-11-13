/**
 * Terrain horizon profile.
 *
 * For each azimuth we march outward over the elevation model and keep the
 * largest apparent elevation angle of the terrain:
 *
 *   angle(d) = atan( (h(d) − h₀ − d² / (2 R_eff)) / d )
 *
 * with h₀ the observer's eye height, d the ground distance and the Earth's
 * curvature drop reduced by terrestrial refraction: R_eff = R / (1 − κ),
 * κ = 0.13 (the standard geodetic refraction coefficient). The result is an
 * apparent altitude, which is what the sky engine draws.
 *
 * The first 300 m are skipped: the elevation model is a surface model (it
 * includes trees and roofs), and an observer normally sets up in an open
 * spot rather than inside the nearest pixel's tree line.
 */

const R_EARTH_M = 6_371_000;
export const REFRACTION_KAPPA = 0.13;
const R_EFF = R_EARTH_M / (1 - REFRACTION_KAPPA);

/** Elevation in metres at a ground offset (east, north) in metres from the site; NaN if unknown. */
export type ElevationSampler = (eastM: number, northM: number) => number;

export interface HorizonOptions {
  /** Number of azimuth bins over 360° (default 720 → 0.5°). */
  bins?: number;
  maxDistM?: number;
  minDistM?: number;
}

/** Apparent horizon altitude (degrees) per azimuth bin, starting at north, eastwards. */
export function horizonProfile(
  sample: ElevationSampler,
  eyeHeightM: number,
  opts: HorizonOptions = {},
): Float32Array {
  const bins = opts.bins ?? 720;
  const maxD = opts.maxDistM ?? 120_000;
  const minD = opts.minDistM ?? 300;
  const out = new Float32Array(bins).fill(-90);
  for (let b = 0; b < bins; b++) {
    const az = ((b + 0.5) / bins) * 2 * Math.PI;
    const se = Math.sin(az);
    const cn = Math.cos(az);
    let best = -Math.PI / 2;
    // Step grows with distance: ~30 m near the site, ~1 km at 50 km.
    for (let d = minD; d <= maxD; d += Math.max(30, d * 0.02)) {
      const h = sample(d * se, d * cn);
      if (!Number.isFinite(h)) continue;
      const a = Math.atan2(h - eyeHeightM - (d * d) / (2 * R_EFF), d);
      if (a > best) best = a;
    }
    out[b] = (best * 180) / Math.PI;
  }
  return out;
}

/** The geometric dip of the sea/flat horizon for an eye at height h (m) above flat ground, degrees (negative). */
export function horizonDip(eyeAboveGroundM: number): number {
  return (-Math.acos(R_EFF / (R_EFF + eyeAboveGroundM)) * 180) / Math.PI;
}

export type Rgb = [number, number, number];

/** Light domes to paint above the horizon (from the light-pollution map). */
export interface DomeGlow {
  /** Artificial / natural brightness near the horizon per 10° of azimuth from north. */
  domes: readonly number[];
  /** Artificial / natural brightness at the zenith (the site's own sky glow). */
  zenith: number;
  /** 0–1: how dark the sky is (domes are invisible in daylight and twilight). */
  strength: number;
}

/** Warm mix of sodium and white LED street light. */
const GLOW_RGB: Rgb = [255, 170, 100];

/**
 * How light pollution looks near the horizon at one azimuth and height h (°)
 * above it, as an opacity. The eye sees a dome by its contrast with the local
 * sky, which in a city is itself many times brighter than a natural sky, so:
 *
 * - directional dome: the excess over the dimmest direction, divided by the
 *   local zenith brightness (1 + R): e = (dome − min) / (1 + R); opacity
 *   1 − e^(−0.15 e), at most 0.6, falling off over 6° of height;
 * - all-round haze (glow from every side): 1 − e^(−0.04 R), at most 0.35,
 *   falling off over 10°;
 * - both taper smoothly to zero by 28° so the layer has no visible edge.
 */
export function glowAlpha(excess: number, zenith: number, h: number): number {
  if (h < 0) return 0;
  const taper = Math.max(0, 1 - h / 28) ** 2;
  const e = (Math.max(0, excess) / (1 + Math.max(0, zenith))) * Math.exp(-h / 6);
  const dome = Math.min(0.6, 1 - Math.exp(-0.15 * e));
  const haze = Math.min(0.35, 1 - Math.exp(-0.04 * Math.max(0, zenith))) * Math.exp(-h / 10);
  return (1 - (1 - dome) * (1 - haze)) * taper;
}

/** Dome brightness at azimuth az (degrees), linear between 10° sectors. */
export function domeAt(domes: readonly number[], az: number): number {
  const n = domes.length;
  if (!n) return 0;
  const pos = ((((az / 360) * n - 0.5) % n) + n) % n;
  const i0 = Math.floor(pos);
  const t = pos - i0;
  return (domes[i0] ?? 0) * (1 - t) + (domes[(i0 + 1) % n] ?? 0) * t;
}

/**
 * Ground texture for the engine's terrain layer: rows from altitude −90° to
 * +30°, opaque below the profile with a 1-pixel anti-aliased edge. With
 * `glow`, light domes and horizon haze are painted above the horizon line
 * (glowAlpha).
 */
export function renderTerrain(
  profile: Float32Array,
  color: Rgb,
  width = 2048,
  height = 512,
  altMin = -90,
  altMax = 30,
  glow: DomeGlow | null = null,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const bins = profile.length;
  const minDome = glow?.domes.length ? Math.min(...glow.domes) : 0;
  const step = (altMax - altMin) / height;
  for (let i = 0; i < width; i++) {
    const pos = ((i + 0.5) / width) * bins - 0.5;
    const i0 = ((Math.floor(pos) % bins) + bins) % bins;
    const i1 = (i0 + 1) % bins;
    const t = pos - Math.floor(pos);
    const hz = (profile[i0] ?? 0) * (1 - t) + (profile[i1] ?? 0) * t;
    const excess =
      glow && glow.strength > 0 ? domeAt(glow.domes, ((i + 0.5) / width) * 360) - minDome : 0;
    for (let j = 0; j < height; j++) {
      const alt = altMin + (j + 0.5) * step;
      const cover = Math.min(1, Math.max(0, (hz - alt) / step + 0.5));
      if (cover <= 0) {
        if (glow && glow.strength > 0 && alt > hz) {
          const a = glowAlpha(excess, glow.zenith, alt - hz) * glow.strength;
          if (a > 0.004) {
            const k = (j * width + i) * 4;
            out[k] = GLOW_RGB[0];
            out[k + 1] = GLOW_RGB[1];
            out[k + 2] = GLOW_RGB[2];
            out[k + 3] = a * 255;
          }
        }
        continue;
      }
      const k = (j * width + i) * 4;
      out[k] = color[0];
      out[k + 1] = color[1];
      out[k + 2] = color[2];
      out[k + 3] = cover * 255;
    }
  }
  return out;
}

/** Ground colour for the light level: near-black at night, dim grey-green by day. */
export function groundColor(sunAlt: number, moonAlt: number, moonIllum: number): Rgb {
  const day = Math.min(1, Math.max(0, (sunAlt + 8) / 14));
  const moon = moonAlt > 0 ? moonIllum * 0.25 : 0;
  const night: Rgb = [4, 5, 6];
  const lit: Rgb = [38, 46, 36];
  const t = Math.min(1, day + moon * (1 - day));
  return [
    night[0] + (lit[0] - night[0]) * t,
    night[1] + (lit[1] - night[1]) * t,
    night[2] + (lit[2] - night[2]) * t,
  ];
}
