/**
 * Seeing estimate (a FORECAST, never a measurement) from model winds.
 *
 * Optical turbulence is described by the refractive-index structure constant
 * C_n²(h). Seeing follows from its integral J = ∫ C_n² dh through the Fried
 * parameter (Fried 1966; Roddier 1981):
 *
 *   r₀ = (0.423 k² J)^(−3/5),  k = 2π/λ          (zenith)
 *   FWHM ε = 0.98 λ / r₀                          (λ = 500 nm)
 *
 * J is split into three parts, each from the Hufnagel–Valley profile
 * (Valley 1980; the "HV 5/7" reference profile: v = 21 m/s, A = 1.7·10⁻¹⁴,
 * giving r₀ = 5 cm and ~2″):
 *
 *   C_n²(h) = 0.00594 (v/27)² (10⁻⁵ h)¹⁰ e^(−h/1000)    upper troposphere, jet stream
 *           + 2.7·10⁻¹⁶ e^(−h/1500)                       lower troposphere
 *           + A e^(−h/100)                                 ground layer
 *
 * 1. Jet stream. Hufnagel's v is the rms wind between 5 and 20 km; we use the
 *    rms of the model winds at 500, 300, 250 and 200 hPa (≈ 5.5–12 km).
 *    Integrated: J = 2.1555·10⁻¹³ (v/27)².
 * 2. Lower troposphere: J = 4.05·10⁻¹³, reduced by e^(−H/1500) for a site at
 *    height H above sea level (mountain sites sit above much of it), and
 *    increased by low-level wind shear, which drives turbulence (C_n² grows
 *    roughly with shear²): × (1 + (S / 12 m/s)²), at most × 4, where S is the
 *    vector difference between the 10 m wind and the 850 hPa wind.
 * 3. Ground layer (the lowest ~100 m: local terrain, buildings, the ground
 *    cooling at night) cannot be forecast from a global model. We assume a
 *    typical 0.7″ for a reasonable amateur site. Tube currents and dome
 *    seeing are not included.
 *
 * Parts combine as J adds: ε_total^(5/3) = Σ ε_i^(5/3).
 *
 * This answers "is the atmosphere cooperating", not "what FWHM will you
 * measure". Daytime convection is not modelled (the night is what matters
 * here).
 */

import { surfaceLayer, type SurfaceInput } from './surfacelayer';

const LAMBDA = 500e-9;
const K2 = ((2 * Math.PI) / LAMBDA) ** 2;
const RAD_TO_ARCSEC = (180 / Math.PI) * 3600;

/** Fried parameter r₀ (m) at 500 nm, zenith, for J = ∫C_n² dh (m^(1/3)). */
export function friedR0(J: number): number {
  return (0.423 * K2 * J) ** (-3 / 5);
}

/** Seeing FWHM (arcsec, 500 nm, zenith) for J. */
export function seeingFromJ(J: number): number {
  return ((0.98 * LAMBDA) / friedR0(J)) * RAD_TO_ARCSEC;
}

/** J that gives a seeing FWHM ε (arcsec). */
export function jFromSeeing(arcsec: number): number {
  const r0 = (0.98 * LAMBDA) / (arcsec / RAD_TO_ARCSEC);
  return r0 ** (-5 / 3) / (0.423 * K2);
}

/** ∫ of the HV upper-troposphere term: 0.00594 (v/27)² · 10! · 10⁻⁵⁰ · 1000¹¹. */
export function hvUpperJ(vMs: number): number {
  const FACT10 = 3628800;
  return 0.00594 * (vMs / 27) ** 2 * FACT10 * 1e-50 * 1000 ** 11;
}

/** ∫ of the HV lower-troposphere term: 2.7·10⁻¹⁶ × 1500 m. */
export const HV_MID_J = 2.7e-16 * 1500;

/** ∫ of the HV 5/7 ground term: A = 1.7·10⁻¹⁴ × 100 m. */
export const HV57_GROUND_J = 1.7e-14 * 100;

/** Assumed typical ground-layer seeing for a reasonable amateur site (used only without weather). */
export const GROUND_ARCSEC = 0.7;

/**
 * Ground layer on a typical night, as J: ε_g^(5/3) = 1 + 4.45·e^(−H/600 m) in units of a
 * 1″ layer, i.e. about 2.8″ at sea level, 1.66″ at 725 m and close to 1″ above 2 km.
 *
 * Calibrated (Nov 2026) on REAL nights, not on hand-picked "typical" weather: ECMWF
 * forecasts for 25 Aug – 12 Nov 2026 were replayed through the model (jet stream and lower
 * air from the forecast winds) and the ground layer was solved so that the median over each
 * site's dark hours matches its measured median seeing: Kavalur 725 m 1.85″ (RAA 2019),
 * Sutherland 1760 m 1.32″, Devasthal 2450 m 1.1″, Hanle 4500 m 1.27″ (DIMM, Parihar et al.
 * 2015). Ocean-facing summits with laminar inflow (Mauna Kea, Paranal) are better than this
 * and are read high (tests/seeing-sites.test.ts, tests/fixtures/seeing-nights.json).
 */
export function typicalGroundJ(elevation: number): number {
  return jFromSeeing(1) * (1 + 4.45 * Math.exp(-Math.max(0, elevation) / 600));
}

/**
 * Night-time change of the ground layer with the weather, about 1 on a typical night:
 * clear skies cool the ground and strengthen the surface inversion (×1.2 clear, ×0.8
 * overcast); wind above 6 m/s at 10 m adds mechanical turbulence (×2 at most). Mild on
 * purpose: the stable-layer physics in surfacelayer.ts collapses to almost no turbulence at
 * low wind, which measured site medians contradict (see typicalGroundJ).
 */
export function nightGroundFactor(windMs: number, cloud: number): number {
  const c = Math.min(1, Math.max(0, cloud));
  const fCloud = 0.8 + 0.4 * (1 - c);
  const fWind = Math.min(2, 1 + Math.max(0, (windMs - 6) / 6) ** 2);
  return fCloud * fWind;
}

/**
 * City heat keeps the air near the ground stirred all night: the ground layer's J grows by
 * 1 + 0.8·urban (urban 0–1 from the light-pollution model, surfacelayer.ts). Calibrated so
 * inner-city Bangalore (920 m) reads about 2.45″ on a clear night and 2.05″ on a cloudy one,
 * matching observers' 2–3″ there and meteoblue's 2.05–2.57″ for 20 Nov 2026 (meteoblue has no
 * city term, so it should read slightly better than a city centre).
 */
export const URBAN_GROUND_GAIN = 0.8;

/** The reference night the ground calibration stands for (same air, rural, 3 m/s, 30 % cloud). */
export function referenceSurface(s: SurfaceInput): SurfaceInput {
  return {
    windMs: 3,
    tempK: s.tempK,
    pressureHpa: s.pressureHpa,
    cloud: 0.3,
    sunAlt: -30,
    z0: 0.1,
    heightM: 1.5,
    urban: 0,
  };
}

/** Night-to-night factor on the ground layer, kept within physical bounds. */
export const GROUND_FACTOR_MIN = 0.25;
export const GROUND_FACTOR_MAX = 6;

export interface WindAt {
  /** Speed, m/s. */
  speed: number;
  /** Direction the wind comes from, degrees. */
  dir: number;
}

export interface SeeingInput {
  /** Winds at 500, 300, 250 and 200 hPa (any that are known). */
  upper: WindAt[];
  /** Wind at 850 hPa. */
  w850: WindAt | null;
  /** 10 m wind. */
  w10: WindAt | null;
  /** Site height above sea level, m. */
  elevation: number;
  /** Near-ground weather (surfacelayer.ts); without it a fixed 0.7″ ground layer is assumed. */
  surface?: SurfaceInput | null;
}

export type SeeingRating = 1 | 2 | 3 | 4 | 5;

export interface SeeingEstimate {
  /** Best estimate, arcsec FWHM at 500 nm, zenith. */
  arcsec: number;
  /** Approximate range (±20 %, the model's honest precision at best). */
  range: [number, number];
  rating: SeeingRating;
  label: string;
  /** Each part alone, arcsec. */
  parts: { jet: number; lower: number; ground: number };
  /** rms upper wind used (m/s) and low-level shear (m/s). */
  jetMs: number;
  shearMs: number | null;
  /** Near-ground conditions behind the ground layer, when weather was given. */
  ground?: {
    /** Ground-layer turbulence relative to a typical night (1 = typical). */
    factor: number;
    regime: 'stable' | 'urban' | 'convective';
    /** Wind 10 m (m/s) and cloud (0–1) used. */
    windMs: number;
    cloud: number;
  };
}

const toVec = (w: WindAt) => {
  const a = (w.dir * Math.PI) / 180;
  return [-w.speed * Math.sin(a), -w.speed * Math.cos(a)] as const;
};

/** Vector difference between two winds, m/s. */
export function shear(a: WindAt, b: WindAt): number {
  const [ax, ay] = toVec(a);
  const [bx, by] = toVec(b);
  return Math.hypot(ax - bx, ay - by);
}

export const RATINGS: readonly { max: number; rating: SeeingRating; label: string }[] = [
  { max: 1.0, rating: 5, label: 'Excellent' },
  { max: 1.5, rating: 4, label: 'Good' },
  { max: 2.0, rating: 3, label: 'Average' },
  { max: 2.75, rating: 2, label: 'Poor' },
  { max: Infinity, rating: 1, label: 'Bad' },
];

export function rateSeeing(arcsec: number): { rating: SeeingRating; label: string } {
  const r = RATINGS.find((x) => arcsec <= x.max) ?? RATINGS[RATINGS.length - 1];
  return { rating: r?.rating ?? 1, label: r?.label ?? 'Bad' };
}

const round1 = (x: number) => Math.round(x * 10) / 10;

export function estimateSeeing(input: SeeingInput): SeeingEstimate | null {
  const speeds = input.upper.map((w) => w.speed).filter((s) => Number.isFinite(s));
  if (!speeds.length) return null;
  const v = Math.sqrt(speeds.reduce((a, s) => a + s * s, 0) / speeds.length);
  const jJet = hvUpperJ(v);

  const s = input.w850 && input.w10 ? shear(input.w850, input.w10) : null;
  const shearFactor = Math.min(4, 1 + ((s ?? 0) / 12) ** 2);
  const jLower = HV_MID_J * Math.exp(-Math.max(0, input.elevation) / 1500) * shearFactor;

  // Ground layer: the site's calibrated typical level (height, city) × this hour's weather.
  // By day the sun-driven convection (surfacelayer.ts physics) takes over.
  let jGround = jFromSeeing(GROUND_ARCSEC);
  let ground: SeeingEstimate['ground'];
  if (input.surface) {
    const sf = input.surface;
    const urban = Math.min(1, Math.max(0, sf.urban ?? 0));
    let factor = nightGroundFactor(sf.windMs, sf.cloud);
    let regime: 'stable' | 'urban' | 'convective' = urban > 0.3 ? 'urban' : 'stable';
    if (sf.sunAlt > 0) {
      const now = surfaceLayer(sf);
      const ref = surfaceLayer(referenceSurface(sf));
      factor = Math.min(GROUND_FACTOR_MAX, Math.max(1, ref.J > 0 ? now.J / ref.J : 1));
      regime = 'convective';
    }
    factor *= 1 + URBAN_GROUND_GAIN * urban;
    jGround = typicalGroundJ(input.elevation) * factor;
    ground = { factor, regime, windMs: sf.windMs, cloud: sf.cloud };
  }

  const arcsec = seeingFromJ(jJet + jLower + jGround);
  const { rating, label } = rateSeeing(arcsec);
  return {
    arcsec,
    // The ground layer varies with the observer's own surroundings: ±30 % is honest.
    range: [round1(arcsec * 0.7), round1(arcsec * 1.3)],
    rating,
    label,
    parts: { jet: seeingFromJ(jJet), lower: seeingFromJ(jLower), ground: seeingFromJ(jGround) },
    jetMs: v,
    shearMs: s,
    ...(ground ? { ground } : {}),
  };
}

/**
 * Relative SNR factor for the imaging score. For background-limited imaging
 * SNR ∝ 1/FWHM; the star image is the seeing combined with a typical 1.5″ from
 * optics, guiding and sampling of an amateur setup. 1 at 0.8″ seeing.
 */
export function seeingFactor(arcsec: number): number {
  const best = Math.hypot(0.8, 1.5);
  return Math.min(1, best / Math.hypot(arcsec, 1.5));
}
