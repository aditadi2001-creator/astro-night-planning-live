/**
 * How haze changes artificial sky glow (light pollution) on a given night.
 *
 * Light going up from a town is scattered back down by air molecules and
 * aerosol particles. More aerosol scatters more of it back down close to the
 * lights, so a hazy or smoggy night makes a city sky brighter; but it also
 * absorbs and scatters away light on its long way to distant places, so the
 * domes of far towns fade. Kocifaj & Barentine (2021) report changes of tens
 * of per cent within a few kilometres of a source; Cinzano & Falchi (2012) and
 * Garstang (1986) show the same near-brighter / far-dimmer behaviour.
 *
 * Model (single scattering, Garstang 1986 geometry): an observer at distance D
 * from a light source looks at the zenith. Light reaches height h along a slant
 * path, is scattered down by molecules (Rayleigh phase) and aerosol
 * (Henyey–Greenstein, g = 0.7, single-scattering albedo 0.9), and is attenuated
 * on both legs. Exponential atmospheres: molecules τ = 0.0973 (550 nm) with an
 * 8 km scale height, aerosol τ = AOD with a 1.5 km scale height. Upward light
 * follows Garstang's city emission function 2G(1−F)cos ψ + 0.554 F ψ⁴ (G = F =
 * 0.15: ground reflection plus direct low-angle light from fixtures).
 *
 * Only the RATIO to a reference night is used (hazeFactor): the yearly
 * light-pollution model is an empirical fit to real SQM readings taken under
 * typical skies, so its absolute level is kept and only the night-to-night
 * change is applied. Reference AOD 0.15 (a typical clear night over land).
 *
 * Results (AOD 0.5 vs 0.15): ×1.8 at 0.5 km, ×1.2 at 2 km, crossover at
 * ~3–5 km, ×0.4 at 10 km, ×0.13 at 50 km.
 *
 * Limits: single scattering only (multiple scattering adds a few per cent at
 * AOD < 0.3 (Aubé 2015) and more in heavy haze, mostly near the lights); flat
 * Earth; one fixed aerosol type and layer height; clear skies only (clouds
 * amplify city glow much more, and are not modelled here).
 */

const TAU_M = 0.0973;
const H_M = 8;
const H_A = 1.5;
const HG_G = 0.7;
const OMEGA = 0.9;
const EM_F = 0.15;
const EM_G = 0.15;

/** AOD (550 nm) of the typical night the yearly light-pollution model represents. */
export const REF_AOD = 0.15;
const MIN_AOD = 0.02;
const MAX_AOD = 1.5;

const STEPS = 240;
const H0 = 0.005;
const H1 = 40;

/** (1 − e^−x) / x, the mean of e^−t over [0, x]. */
const meanExp = (x: number) => (x < 1e-6 ? 1 - x / 2 : (1 - Math.exp(-x)) / x);

/**
 * Relative artificial zenith brightness from a light source at horizontal
 * distance `dKm`, for aerosol optical depth `aod` (arbitrary units: use ratios).
 */
export function zenithGlow(dKm: number, aod: number): number {
  const D = Math.max(0.5, dKm);
  const ta = Math.min(MAX_AOD, Math.max(MIN_AOD, aod));
  const hg2 = HG_G * HG_G;
  let sum = 0;
  for (let i = 0; i < STEPS; i++) {
    const ha = H0 * (H1 / H0) ** (i / STEPS);
    const hb = H0 * (H1 / H0) ** ((i + 1) / STEPS);
    const h = Math.sqrt(ha * hb);
    const s = Math.hypot(D, h);
    const cosPsi = h / s;
    const psi = Math.acos(cosPsi);
    const emission = 2 * EM_G * (1 - EM_F) * cosPsi + 0.554 * EM_F * psi ** 4;
    // Slant optical depth from the ground to height h along the source's ray.
    const slant = ((TAU_M * s) / H_M) * meanExp(h / H_M) + ((ta * s) / H_A) * meanExp(h / H_A);
    // Scattering angle between the incoming ray and the way down to the observer.
    const cosT = -cosPsi;
    const pm = (3 / (16 * Math.PI)) * (1 + cosT * cosT);
    const pa = (1 - hg2) / (4 * Math.PI * (1 + hg2 - 2 * HG_G * cosT) ** 1.5);
    const bm = (TAU_M / H_M) * Math.exp(-h / H_M);
    const ba = ((OMEGA * ta) / H_A) * Math.exp(-h / H_A);
    const down = Math.exp(-(TAU_M * (1 - Math.exp(-h / H_M)) + ta * (1 - Math.exp(-h / H_A))));
    sum += (emission / (s * s)) * Math.exp(-slant) * (bm * pm + ba * pa) * down * (hb - ha);
  }
  return sum;
}

/** Artificial sky glow from lights `dKm` away on a night with `aod`, relative to the reference night. */
export function hazeFactor(dKm: number, aod: number): number {
  return zenithGlow(dKm, aod) / zenithGlow(dKm, REF_AOD);
}

// ---- distance bins shared with the light-pollution loader --------------------------

/** Log-spaced distance bins from 0.5 to 150 km for the light around a site. */
export const DIST_BINS = 16;
const D_MIN = 0.5;
const D_MAX = 150;

/** Bin index for a distance (km); the site's own lights (< 0.5 km) go in bin 0. */
export function distBin(dKm: number): number {
  if (dKm <= D_MIN) return 0;
  const k = Math.floor((DIST_BINS * Math.log(dKm / D_MIN)) / Math.log(D_MAX / D_MIN));
  return Math.min(DIST_BINS - 1, Math.max(0, k));
}

/** Geometric centre of a bin (km). */
export function binCentre(k: number): number {
  return D_MIN * (D_MAX / D_MIN) ** ((k + 0.5) / DIST_BINS);
}

const cache = new Map<number, number[]>();

/** hazeFactor at every bin centre, memoised per 0.01 of AOD. */
export function binFactors(aod: number): number[] {
  const key = Math.round(Math.min(MAX_AOD, Math.max(MIN_AOD, aod)) * 100);
  let f = cache.get(key);
  if (!f) {
    f = Array.from({ length: DIST_BINS }, (_, k) => hazeFactor(binCentre(k), key / 100));
    if (cache.size > 300) cache.clear();
    cache.set(key, f);
  }
  return f;
}

/** Weighted mean haze factor for light arriving from the given distance bins (1 if no light). */
export function weightedHaze(weights: readonly number[], aod: number): number {
  const f = binFactors(aod);
  let num = 0;
  let den = 0;
  for (let k = 0; k < weights.length && k < DIST_BINS; k++) {
    const w = weights[k] ?? 0;
    num += w * (f[k] ?? 1);
    den += w;
  }
  return den > 0 ? num / den : 1;
}
