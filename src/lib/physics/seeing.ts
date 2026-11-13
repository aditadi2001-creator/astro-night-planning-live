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

/** Assumed typical ground-layer seeing for a reasonable amateur site. */
export const GROUND_ARCSEC = 0.7;

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
  const jGround = jFromSeeing(GROUND_ARCSEC);

  const arcsec = seeingFromJ(jJet + jLower + jGround);
  const { rating, label } = rateSeeing(arcsec);
  return {
    arcsec,
    range: [round1(arcsec * 0.8), round1(arcsec * 1.2)],
    rating,
    label,
    parts: { jet: seeingFromJ(jJet), lower: seeingFromJ(jLower), ground: GROUND_ARCSEC },
    jetMs: v,
    shearMs: s,
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
