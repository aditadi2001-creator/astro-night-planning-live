/**
 * Infrared satellite cloud estimate, and how it is blended with the forecast.
 *
 * A thermal-infrared pixel shows the temperature of whatever the satellite
 * sees: the ground when it is clear, cloud tops when it is not. Clouds are
 * colder than the ground, so "how much colder than the surface air" is a
 * simple, well-known cloud test. Its limits, stated in the UI too:
 * - clear-sky pixels read a few kelvin below the ground (water vapour; up to
 *   ~8 K in the humid tropics, measured on GMGSI against model skin
 *   temperatures), so only pixels more than CLEAR_MARGIN colder count;
 * - low fog and stratus are about as warm as the ground and are missed;
 * - thin cirrus reads only slightly cold, so it counts as partial cloud.
 * That is why the result is blended with the model, not used alone.
 */
import type { CloudSample } from '../sky/clouds';

/** GMGSI longwave grey level (0–255) → brightness temperature (K). */
export const kelvinFromGrey = (grey: number): number => (660 - grey) / 2;

/** Pixels warmer than (surface − CLEAR_MARGIN) count as clear. */
export const CLEAR_MARGIN_K = 8;
/** …and fully cloudy once RAMP_K colder than that. */
export const RAMP_K = 12;
/** Cloud tops colder than this are high cloud (cirrus, deep convection). */
export const HIGH_TOP_K = 240;

/** Cloud fraction 0–1 of a group of IR pixels; null without pixels. */
export function irCloudFraction(btK: readonly number[], surfaceK: number): number | null {
  if (!btK.length || !Number.isFinite(surfaceK)) return null;
  let sum = 0;
  for (const t of btK) {
    sum += Math.min(1, Math.max(0, (surfaceK - CLEAR_MARGIN_K - t) / RAMP_K));
  }
  return sum / btK.length;
}

/**
 * Weight of the satellite against the model. An observation is better than a
 * forecast when it is recent; after a few hours the clouds have moved on.
 * 0.6 up to 1.5 h old, falling linearly to 0 at 6 h. The age is measured from
 * the time being shown, so scrubbing into the future hands over to the model.
 */
export function satelliteWeight(ageHours: number): number {
  const a = Math.abs(ageHours);
  if (!Number.isFinite(a)) return 0;
  if (a <= 1.5) return 0.6;
  if (a >= 6) return 0;
  return 0.6 * (1 - (a - 1.5) / 4.5);
}

/** "Clouds now" (%) from model total cover (%) and the satellite fraction (0–1). */
export function cloudsNow(model: number | null, sat: number | null, w: number): number | null {
  if (model == null && sat == null) return null;
  if (sat == null || w <= 0) return model;
  if (model == null) return sat * 100;
  return w * sat * 100 + (1 - w) * model;
}

/** Total cover (0–1) of three layers with random overlap. */
const total = (l: number, m: number, h: number) => 1 - (1 - l) * (1 - m) * (1 - h);

export interface SatPoint {
  /** Cloud fraction 0–1, or null without data. */
  frac: number | null;
  /** Mean brightness temperature of the pixels (K). */
  meanK: number | null;
}

/**
 * Adjust one sample's low/mid/high cover (%) so its total moves towards the
 * satellite by weight w. The model's split between layers is kept; cloud the
 * model does not have at all goes to the high layer when the tops are very
 * cold, otherwise to the mid layer.
 */
export function blendLayers(
  layers: { low: number; mid: number; high: number },
  sat: SatPoint,
  w: number,
): { low: number; mid: number; high: number } {
  if (sat.frac == null || w <= 0) return layers;
  const l = layers.low / 100;
  const m = layers.mid / 100;
  const h = layers.high / 100;
  const t = total(l, m, h);
  const target = w * sat.frac + (1 - w) * t;
  if (t > 0.05) {
    const s = target / t;
    return {
      low: Math.min(100, l * s * 100),
      mid: Math.min(100, m * s * 100),
      high: Math.min(100, h * s * 100),
    };
  }
  // The model sees (almost) nothing: add the missing cloud as one layer.
  const add = Math.max(0, target - t);
  const high = sat.meanK != null && sat.meanK < HIGH_TOP_K;
  return {
    low: layers.low,
    mid: high ? layers.mid : Math.min(100, (m + add) * 100),
    high: high ? Math.min(100, (h + add) * 100) : layers.high,
  };
}

/** Blend every sample of the sky's cloud field with the satellite at the same points. */
export function blendSamples(
  samples: readonly CloudSample[],
  sat: readonly SatPoint[],
  w: number,
): CloudSample[] {
  return samples.map((s, i) => {
    const p = sat[i];
    return p ? { ...s, ...blendLayers(s, p, w) } : s;
  });
}
