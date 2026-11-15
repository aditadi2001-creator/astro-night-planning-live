/**
 * Natural night-sky brightness and the solar cycle.
 *
 * The natural zenith sky (airglow + zodiacal light + faint stars) is not a
 * constant: airglow, mostly the [O I] 557.7 nm line inside the V band, follows
 * solar activity. Krisciunas et al. (2007, PASP 119, 687) found the yearly
 * V-band sky at Cerro Tololo best correlated with the 10.7 cm solar flux
 * taken ~5 days earlier.
 *
 * Fit used here: their Table 5 yearly zenith V averages for 1992–2006, in
 * linear flux, against the yearly mean observed F10.7 for the same years
 * (daily values from GFZ Potsdam, Kp_ap_Ap_SN_F107_since_1932.txt):
 *
 *   B / B(22.0 mag) = 0.8069 + 0.003188 · F10.7      r = 0.77, 14 years
 *
 * That gives 21.97 at solar minimum (F10.7 ≈ 70) and 21.63 at a strong
 * maximum (≈ 190), a swing of 0.34 mag, in line with the 0.3–0.5 mag usually
 * quoted for V. We anchor the curve at 22.0 for F10.7 = 70, which is the
 * natural sky the light-pollution model was calibrated against. So:
 *
 *   - light pollution itself (map colours, Bortle class) stays referenced to
 *     that 22.0 solar-minimum sky;
 *   - "the sky right now" (site SQM, faintest star, imaging score) adds
 *     today's natural sky from the current solar flux.
 *
 * Night-to-night airglow varies by a few tenths of a magnitude more than this
 * (gravity waves, season, geomagnetic storms); the solar term is only the slow
 * part that can be predicted.
 */
import { fetchJson, type Cached } from '../data/cache';
import { NATURAL_SKY_MAG } from './skybrightness';

/** F10.7 (sfu) at which the natural sky is NATURAL_SKY_MAG (22.0): solar minimum. */
export const REFERENCE_FLUX = 70;
const FIT_A = 0.8069;
const FIT_B = 0.003188;
/** Long-run mean F10.7, used when no recent value is known. */
export const TYPICAL_FLUX = 110;

/**
 * Brightness of the natural sky relative to the 22.0 mag/arcsec² reference
 * (1 at solar minimum, ~1.37 at a strong maximum).
 */
export function naturalSkyFactor(f107: number): number {
  const s = Math.min(300, Math.max(60, f107));
  return (FIT_A + FIT_B * s) / (FIT_A + FIT_B * REFERENCE_FLUX);
}

/** Natural zenith sky brightness (V, mag/arcsec²) for a 10.7 cm solar flux in sfu. */
export function naturalSkyMag(f107: number): number {
  return NATURAL_SKY_MAG - 2.5 * Math.log10(naturalSkyFactor(f107));
}

/**
 * Total zenith sky (mag/arcsec²) from light pollution referenced to the 22.0
 * sky (`ratio` = artificial / reference natural) plus today's natural sky.
 */
export function skyWithNatural(ratio: number, naturalMag: number): number {
  return NATURAL_SKY_MAG - 2.5 * Math.log10(10 ** (-0.4 * (naturalMag - NATURAL_SKY_MAG)) + ratio);
}

/** A sky brightness quoted against the 22.0 reference sky, re-quoted under today's natural sky. */
export function skyFromReference(sqmRef: number, naturalMag: number): number {
  return skyWithNatural(Math.max(0, 10 ** (0.4 * (NATURAL_SKY_MAG - sqmRef)) - 1), naturalMag);
}

// ---- current solar flux (NOAA SWPC, public domain, no key) -------------------------

export const F107_URL = 'https://services.swpc.noaa.gov/json/f107_cm_flux.json';

interface F107Raw {
  time_tag: string;
  flux: number;
}

export interface SolarFlux {
  /** Mean observed F10.7 (sfu) over the averaging window. */
  flux: number;
  /** Daily readings averaged. */
  readings: number;
  /** End of the averaging window (ms). */
  until: number;
}

const DAY = 86_400_000;
/** The sky follows the flux of ~5 days earlier; a 27-day window (one solar rotation) smooths it. */
const LAG_DAYS = 5;
const WINDOW_DAYS = 27;

/** Mean flux over the 27 days ending 5 days before the newest reading (all readings if too few). */
export function meanSolarFlux(raw: readonly F107Raw[]): SolarFlux | null {
  const pts = raw
    .map((r) => ({ t: Date.parse(r.time_tag + (r.time_tag.endsWith('Z') ? '' : 'Z')), f: r.flux }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.f) && p.f > 0);
  if (!pts.length) return null;
  const newest = Math.max(...pts.map((p) => p.t));
  const until = newest - LAG_DAYS * DAY;
  let use = pts.filter((p) => p.t <= until && p.t > until - WINDOW_DAYS * DAY);
  if (use.length < 5) use = pts;
  return { flux: use.reduce((a, p) => a + p.f, 0) / use.length, readings: use.length, until };
}

export async function loadSolarFlux(
  signal: AbortSignal,
  force = false,
): Promise<Cached<SolarFlux>> {
  return fetchJson<SolarFlux, F107Raw[]>('f107', F107_URL, {
    maxAgeMs: force ? 0 : 12 * 3600_000,
    signal,
    transform: (raw) => {
      const m = meanSolarFlux(raw);
      if (!m) throw new Error('No solar flux readings');
      return m;
    },
  });
}
