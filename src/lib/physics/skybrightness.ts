/**
 * Zenith sky brightness and naked-eye limiting magnitude.
 *
 * Sky brightness at the zenith (nanoLamberts, then V mag/arcsec²) is the sum
 * of three published components:
 *
 *  natural   22.0 mag/arcsec² (airglow + zodiacal light + unresolved stars), the
 *            value used for the natural sky by Falchi et al. (2016) and
 *            Cinzano et al. (2001). Light pollution adds to this later.
 *  twilight  Schaefer (1993), "Astronomy and the limits of vision", Vistas in
 *            Astronomy 36, 311: log₁₀ B = −6.724 + 22.918 h⊙ (h⊙ in rad),
 *            × (1.745 / ψ) × (1 − 10^(−0.4 k X)) in the units of that paper
 *            (B / 1.11·10⁻¹⁵ = nL). Same model as the engine's sky.
 *  moon      Krisciunas & Schaefer (1991) — see moonlight.ts.
 *
 * Limiting magnitude for a point source uses the Hecht (1947) threshold law
 * as applied by Schaefer (1990, PASP 102, 212):
 *     I = c₁ (1 + √(c₂ B))²   [foot-candles],   m = −16.57 − 2.5 log₁₀ I
 * with night-vision constants c₁ = 10^−9.8, c₂ = 10^−1.9 (B in nL), switching
 * to day constants c₁ = 10^−8.35, c₂ = 10^−5.9 above B ≈ 1480 nL (log B > 3.17).
 * Cross-checks (tests/skybrightness.test.ts):
 *  - Dark and rural skies (SQM ≥ 18.6, night vision): identical to the form
 *    NELM = 7.93 − 5 log₁₀(10^(4.316 − SQM/5) + 1) that Birriel et al. (2014,
 *    JAAVSO 42, 219) derived from Schaefer's equations for Globe at Night.
 *    Under a natural 22.0 sky this gives NELM ≈ 6.6.
 *  - Bright skies (SQM < 18.6, cone vision): within 0.4 mag of Crumey (2014,
 *    MNRAS 442, 2600), m = 0.426 μ − 2.365 − 2.5 log F with field factor F = 2.
 *    (The Birriel/SQM form keeps the night-vision law and becomes far too
 *    pessimistic in city and twilight skies, so it is not used there.)
 */
import { magToNl, moonSkyBrightness, nlToMag } from './moonlight';

export const NATURAL_SKY_MAG = 22.0;
const DEG = Math.PI / 180;

/** Twilight brightness at the zenith in nL (Schaefer 1993), 0 when the Sun is below −24°. */
export function twilightZenithNl(sunAltDeg: number, k: number): number {
  if (sunAltDeg < -24) return 0;
  const h = sunAltDeg * DEG;
  const psi = (90 - sunAltDeg) * DEG; // Sun–zenith distance
  const b = 10 ** (-6.724 + 22.918312 * h) * (1.7453293 / psi) * (1 - 10 ** (-0.4 * k));
  return Math.max(0, b / 1.11e-15);
}

export interface SkyBrightnessInput {
  sunAlt: number;
  moonAlt: number;
  moonPhaseAngle: number;
  /** Angle between the Moon and the zenith is 90 − moonAlt. */
  extinction: number;
  /** Zenith brightness without Moon/twilight (natural + light pollution), mag/arcsec². */
  baseMag?: number;
}

export interface SkyBrightness {
  /** Total zenith brightness, V mag/arcsec² (an "SQM-like" value). */
  mag: number;
  nl: number;
  parts: { base: number; twilight: number; moon: number };
}

export function zenithSkyBrightness(i: SkyBrightnessInput): SkyBrightness {
  const base = magToNl(i.baseMag ?? NATURAL_SKY_MAG);
  const twilight = twilightZenithNl(i.sunAlt, i.extinction);
  const moon = moonSkyBrightness(
    { phaseAngle: i.moonPhaseAngle, moonAlt: i.moonAlt, targetAlt: 90, separation: 90 - i.moonAlt },
    i.extinction,
  );
  const nl = base + twilight + moon;
  return { nl, mag: nlToMag(nl), parts: { base, twilight, moon } };
}

/** Naked-eye limiting magnitude of a point source against background B (nL), before extinction. */
export function limitingMagnitude(bNl: number): number {
  const b = Math.max(1e-3, bNl);
  const night = Math.log10(b) < 3.17;
  const c1 = night ? 10 ** -9.8 : 10 ** -8.35;
  const c2 = night ? 10 ** -1.9 : 10 ** -5.9;
  const i = c1 * (1 + Math.sqrt(c2 * b)) ** 2;
  return -16.57 - 2.5 * Math.log10(i);
}

/** Birriel et al. (2014) SQM → NELM form of Schaefer's night-vision law (cross-check only). */
export function nelmFromSqm(sqm: number): number {
  return 7.93 - 5 * Math.log10(10 ** (4.316 - sqm / 5) + 1);
}

/** Crumey (2014) limiting magnitude for sky brightness μ (mag/arcsec²), field factor F (cross-check only). */
export function nelmCrumey(mu: number, fieldFactor = 2): number {
  return 0.426 * mu - 2.365 - 2.5 * Math.log10(fieldFactor);
}
