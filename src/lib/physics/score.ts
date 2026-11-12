/**
 * Hourly imaging score (0–100) and model agreement.
 *
 * Deep-sky imaging is usually limited by sky background, where the
 * signal-to-noise ratio scales as S / √B (signal S, sky background B). The
 * score is the product of relative SNR factors, each 1 for ideal conditions:
 *
 *   clouds        1 − blocked fraction. Layers combined with random overlap;
 *                 high cloud (mostly thin cirrus) blocks 60 % of the light
 *                 where present: 1 − (1 − L)(1 − M)(1 − 0.6 H).
 *   transparency  10^(−0.4 (k − k₀) X), signal lost to extinction k relative
 *                 to a clean site k₀ = 0.15 at a typical target airmass X = 1.5.
 *   moon          √(B_dark / (B_dark + B_moon)), Krisciunas & Schaefer (1991)
 *                 moonlight at a typical target 45° high and 90° from the Moon.
 *   darkness      0 above −12° Sun altitude, 1 below −18°, linear between
 *                 (astronomical twilight still brightens the sky).
 *   seeing        not yet included (added with the seeing model).
 *
 * The weights are physics-based but the "typical target" is a simplification:
 * the score answers "how good is this hour in general", not for one object.
 */
import { moonSkyBrightness, magToNl } from './moonlight';
import { NATURAL_SKY_MAG } from './skybrightness';

export interface HourConditions {
  /** Cloud cover in percent. */
  cloudLow: number;
  cloudMid: number;
  cloudHigh: number;
  /** Zenith V extinction, mag/airmass. */
  extinction: number;
  sunAlt: number;
  moonAlt: number;
  /** Lunar phase angle in degrees (0 = full). */
  moonPhaseAngle: number;
  /** Zenith brightness without Moon, V mag/arcsec² (natural sky until the light-pollution layer exists). */
  darkSkyMag?: number;
}

export interface ScoreParts {
  clouds: number;
  transparency: number;
  moon: number;
  darkness: number;
  score: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function cloudFactor(low: number, mid: number, high: number): number {
  const l = clamp01(low / 100);
  const m = clamp01(mid / 100);
  const h = clamp01(high / 100);
  const blocked = 1 - (1 - l) * (1 - m) * (1 - 0.6 * h);
  return clamp01(1 - blocked);
}

export function transparencyFactor(k: number, k0 = 0.15, airmass = 1.5): number {
  return clamp01(10 ** (-0.4 * (k - k0) * airmass));
}

export function darknessFactor(sunAlt: number): number {
  return clamp01((-12 - sunAlt) / 6);
}

export function moonFactor(c: HourConditions): number {
  const bMoon = moonSkyBrightness(
    { phaseAngle: c.moonPhaseAngle, moonAlt: c.moonAlt, targetAlt: 45, separation: 90 },
    c.extinction,
  );
  const bDark = magToNl(c.darkSkyMag ?? NATURAL_SKY_MAG);
  return Math.sqrt(bDark / (bDark + bMoon));
}

export function imagingScore(c: HourConditions): ScoreParts {
  const parts = {
    clouds: cloudFactor(c.cloudLow, c.cloudMid, c.cloudHigh),
    transparency: transparencyFactor(c.extinction),
    moon: moonFactor(c),
    darkness: darknessFactor(c.sunAlt),
  };
  const score = Math.round(100 * parts.clouds * parts.transparency * parts.moon * parts.darkness);
  return { ...parts, score };
}

export type Agreement = 'high' | 'medium' | 'low' | 'unknown';

/**
 * Model agreement from the spread (max − min) of total cloud cover between
 * models: ≤ 20 points high, ≤ 45 medium, otherwise low.
 */
export function modelAgreement(values: (number | null | undefined)[]): {
  agreement: Agreement;
  spread: number | null;
} {
  const v = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  if (v.length < 2) return { agreement: 'unknown', spread: null };
  const spread = Math.max(...v) - Math.min(...v);
  return { agreement: spread <= 20 ? 'high' : spread <= 45 ? 'medium' : 'low', spread };
}
