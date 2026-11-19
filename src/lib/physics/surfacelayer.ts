/**
 * Near-ground optical turbulence: the part of the seeing that dominates for a
 * telescope standing on the ground, and that a fixed guess got badly wrong.
 *
 * Measurements put most of the turbulence a ground-level telescope looks
 * through in the lowest tens of metres (e.g. Dome C: 0.93″ median at 3 m vs
 * 0.55″ at 8 m; the surface layer is 35–63 % of all seeing at Paranal, Mauna
 * Kea and La Palma, where telescopes stand 6–30 m up). It depends on how much
 * the ground cools (clear vs cloudy), the wind, and how rough the surroundings
 * are, all of which the forecast gives.
 *
 * 1. Surface fluxes, exactly as the US EPA's AERMET/AERMOD meteorology
 *    (AERMOD Model Formulation, EPA-454/B-24-010, 2024, §3):
 *    - Night (stable): θ* = 0.09 (1 − 0.5 n²) K (van Ulden & Holtslag 1985,
 *      eq. 16); u* from the quadratic of eq. 15 with C_D = k / ln(z_ref/z₀),
 *      u₀² = β_m z_ref g θ* / T, β_m = 5, and the linear low-wind form below the
 *      critical speed; L = T u*² / (k g θ*) (eq. 11); boundary-layer depth
 *      2400 u*^1.5 m (eq. 24).
 *    - Day (convective): net radiation Rₙ from the Sun's height and cloud
 *      (Holtslag & van Ulden 1983, eqs. 3–4), H = 0.9 Rₙ / (1 + 1/B₀) (eq. 2),
 *      u* and L by iteration with the Businger–Dyer ψ (eqs. 6–8).
 * 2. Temperature structure parameter (Wyngaard, Izumi & Collins 1971):
 *    C_T² z^(2/3) / T*² = 4.9 (1 + 2.4 (z/L)^(2/3))  stable
 *                       = 4.9 (1 − 7 z/L)^(−2/3)     unstable
 *    Above the surface layer of a stable night, Nieuwstadt's (1984) local
 *    scaling: θ*(z) = θ*(1 − z/h)^(1/4), Λ(z) = L(1 − z/h)^(5/4), so turbulence
 *    fades to zero at the top of the stable layer h.
 * 3. C_n² = (79·10⁻⁶ P / T²)² C_T² (P in hPa), integrated from the telescope's
 *    height to the top of the boundary layer.
 *
 * Roughness z₀ comes from the surroundings (city ~1 m, suburbs ~0.5 m, farmland
 * 0.1 m, open grass 0.03 m); the site estimates it from its light pollution.
 * Not included: tube currents and dome seeing, the telescope's own
 * surroundings (a hot roof, a valley's cold-air pool or a summit's clean
 * flow), and urban heat released at night.
 */

const K_VK = 0.4;
const G = 9.81;
const CP = 1005;
const BETA_M = 5;
const Z_REF = 10;
const SIGMA = 5.67e-8;
/** Surface layer = this fraction of the boundary layer (the textbook ~10 %). */
export const SURFACE_FRACTION = 0.1;

export interface SurfaceInput {
  /** 10 m wind, m/s. */
  windMs: number;
  /** 2 m air temperature, K. */
  tempK: number;
  /** Station pressure, hPa. */
  pressureHpa: number;
  /** Total cloud cover, 0–1. */
  cloud: number;
  /** Sun altitude, degrees. */
  sunAlt: number;
  /** Roughness length of the surroundings, m. */
  z0: number;
  /** Height of the telescope above the ground, m (default 1.5). */
  heightM?: number;
  /** Bowen ratio for daytime heat flux (default 0.7; cities ~1.5, deserts ~5). */
  bowen?: number;
  /**
   * How built-up the spot is, 0 (country) – 1 (big-city centre): scales the
   * night-time urban heat island (see urbanFromLight).
   */
  urban?: number;
}

/** AERMOD urban heat-island constants (§5.10): maximum ΔT (°C) and area-averaged α. */
export const URBAN_DT_MAX = 12;
export const URBAN_ALPHA = 0.03;
/** Upper limit of the night-time urban heat flux, W/m². */
export const URBAN_H_MAX = 50;

export interface SurfaceLayer {
  stable: boolean;
  /** Friction velocity, m/s. */
  uStar: number;
  /** Temperature scale (K): positive for stable nights. */
  thetaStar: number;
  /** Monin–Obukhov length, m (positive stable, negative convective). */
  L: number;
  /** Boundary-layer depth integrated over, m. */
  h: number;
  /** Sensible heat flux, W/m² (negative at night). */
  H: number;
  /** ∫ C_n² dz from the telescope to h, m^(1/3). */
  J: number;
  /** True when the city's stored heat makes the night-time surface layer convective. */
  urbanHeat?: boolean;
}

/** Stable night (AERMOD eqs. 11, 15, 16, 24). */
export function stableFluxes(windMs: number, tempK: number, cloud: number, z0: number) {
  const n = Math.min(1, Math.max(0, cloud));
  let theta = 0.09 * (1 - 0.5 * n * n);
  const zr = Math.max(Z_REF, 7 * z0);
  const cd = K_VK / Math.log(zr / z0);
  const u0sq = (BETA_M * zr * G * theta) / tempK;
  const ucr = Math.sqrt((4 * u0sq) / cd);
  const ustarAt = (u: number) =>
    ((cd * u) / 2) * (1 + Math.sqrt(Math.max(0, 1 - (4 * u0sq) / (cd * u * u))));
  const u = Math.max(0.05, windMs);
  let ustar: number;
  if (u >= ucr) ustar = ustarAt(u);
  else {
    ustar = ustarAt(ucr) * (u / ucr);
    theta *= u / ucr;
  }
  const L = (tempK * ustar * ustar) / (K_VK * G * Math.max(1e-4, theta));
  const h = Math.max(15, 2400 * ustar ** 1.5);
  return { ustar, theta, L, h };
}

/** Holtslag & van Ulden (1983) net radiation, W/m² (AERMOD eqs. 3–4). */
export function netRadiation(sunAlt: number, tempK: number, cloud: number, albedoNoon = 0.2) {
  const n = Math.min(1, Math.max(0, cloud));
  const r0 = Math.max(0, 990 * Math.sin((sunAlt * Math.PI) / 180) - 30);
  const R = r0 * (1 - 0.75 * n ** 3.4);
  const r = albedoNoon + (1 - albedoNoon) * Math.exp(-0.1 * sunAlt - 0.5 * (1 - albedoNoon));
  return ((1 - r) * R + 5.31e-13 * tempK ** 6 - SIGMA * tempK ** 4 + 60 * n) / 1.12;
}

const psiM = (zeta: number) => {
  const mu = (1 - 16 * zeta) ** 0.25;
  return 2 * Math.log((1 + mu) / 2) + Math.log((1 + mu * mu) / 2) - 2 * Math.atan(mu) + Math.PI / 2;
};

/** Convective day: u*, L from H (AERMOD eqs. 6–8), iterated. */
export function convectiveFluxes(
  windMs: number,
  tempK: number,
  rho: number,
  H: number,
  z0: number,
) {
  const zr = Math.max(Z_REF, 7 * z0);
  const u = Math.max(0.3, windMs);
  let ustar = (K_VK * u) / Math.log(zr / z0);
  let L = -1e6;
  for (let i = 0; i < 30; i++) {
    L = -(rho * CP * tempK * ustar ** 3) / (K_VK * G * H);
    const next = (K_VK * u) / (Math.log(zr / z0) - psiM(zr / L) + psiM(z0 / L));
    if (Math.abs(next - ustar) < 1e-4) {
      ustar = next;
      break;
    }
    ustar = next;
  }
  return { ustar, L };
}

/** Structure function f = C_T² z^(2/3) / T*² (Wyngaard et al. 1971). */
export const wyngaard = (zOverL: number) =>
  zOverL >= 0 ? 4.9 * (1 + 2.4 * zOverL ** (2 / 3)) : 4.9 * (1 - 7 * zOverL) ** (-2 / 3);

export function surfaceLayer(i: SurfaceInput): SurfaceLayer {
  const zTel = Math.max(0.3, i.heightM ?? 1.5);
  const T = i.tempK;
  const P = i.pressureHpa;
  const rho = (P * 100) / (287.05 * T);
  const cn2PerCt2 = ((79e-6 * P) / (T * T)) ** 2;
  const Rn = i.sunAlt > -1 ? netRadiation(i.sunAlt, T, i.cloud) : -1;
  const Hday = Rn > 0 ? (0.9 * Rn) / (1 + 1 / (i.bowen ?? 0.7)) : 0;

  const steps = 160;
  const integrate = (top: number, ct2: (z: number) => number) => {
    if (top <= zTel) return 0;
    let J = 0;
    for (let k = 0; k < steps; k++) {
      const za = zTel * (top / zTel) ** (k / steps);
      const zb = zTel * (top / zTel) ** ((k + 1) / steps);
      const z = Math.sqrt(za * zb);
      J += cn2PerCt2 * ct2(z) * (zb - za);
    }
    return J;
  };

  if (Hday > 5) {
    const { ustar, L } = convectiveFluxes(i.windMs, T, rho, Hday, i.z0);
    const tStar = Hday / (rho * CP * ustar);
    // Daytime mixed layer: ~1 km; above ~0.1 of it C_T² falls as z^(−4/3) (the formula's own limit).
    const h = 1000;
    const J = integrate(
      SURFACE_FRACTION * h,
      (z) => tStar * tStar * z ** (-2 / 3) * wyngaard(z / L),
    );
    return { stable: false, uStar: ustar, thetaStar: -tStar, L, h, H: Hday, J };
  }
  const s = stableFluxes(i.windMs, T, i.cloud, i.z0);
  // Similarity theory holds in the surface layer, the lowest ~10 % of the boundary layer;
  // above it the free-atmosphere terms of seeing.ts take over.
  const jStable = integrate(SURFACE_FRACTION * s.h, (z) => {
    const f = Math.max(0, 1 - z / s.h);
    const thetaLocal = s.theta * f ** 0.25;
    const lambda = Math.max(1e-3, s.L * f ** 1.25);
    return thetaLocal * thetaLocal * z ** (-2 / 3) * wyngaard(z / lambda);
  });
  // Cities at night (AERMOD §5.10, after Oke 1973/1982): the built-up surface stays warmer
  // than the country (ΔT up to 12 °C) and heats the air from below, H_u = α ρ c_p ΔT u*
  // with α = 0.03. AERMOD ADDS this convective-like turbulence to the rural stable one.
  const urban = Math.min(1, Math.max(0, i.urban ?? 0));
  // Measured night-time urban heat fluxes are mostly 0–50 W/m² (Grimmond & Oke 2002).
  const Hu = Math.min(URBAN_H_MAX, URBAN_ALPHA * rho * CP * URBAN_DT_MAX * urban * s.ustar);
  let jUrban = 0;
  if (Hu > 1) {
    const { ustar, L } = convectiveFluxes(i.windMs, T, rho, Hu, i.z0);
    const tStar = Hu / (rho * CP * ustar);
    // Urban night mixed layer: ~400 m for a large city, never below the mechanical depth.
    const h = Math.max(s.h, 400 * Math.max(0.3, urban));
    jUrban = integrate(
      SURFACE_FRACTION * h,
      (z) => tStar * tStar * z ** (-2 / 3) * wyngaard(z / L),
    );
  }
  return {
    stable: jUrban <= jStable,
    uStar: s.ustar,
    thetaStar: s.theta,
    L: s.L,
    h: s.h,
    H: -rho * CP * s.ustar * s.theta + Hu,
    J: jStable + jUrban,
    urbanHeat: jUrban > jStable,
  };
}

/**
 * How built-up a spot is (0–1) from its artificial/natural zenith brightness R
 * (yearly light-pollution model): log10(1 + R) / 2, so open country (R < 0.3)
 * ≈ 0, a town (R ≈ 3) 0.3, suburbs (R ≈ 10–30) 0.5–0.75, a big-city centre
 * (R ≈ 100) 1. A stand-in for AERMOD's city population, which the site does not
 * know; night lights and urban heat-island strength are well correlated.
 */
export function urbanFromLight(ratio: number | null): number {
  if (ratio == null || !Number.isFinite(ratio) || ratio <= 0) return 0;
  return Math.min(1, Math.log10(1 + ratio) / 2);
}

/**
 * Roughness length (m) of a site's surroundings from its light pollution
 * (mag brighter than a natural sky): built-up areas are rough, open country
 * smooth. Approximate (Wieringa 1993 classes): inner city 1.0, city 0.7,
 * suburbs 0.4, villages/farmland 0.15, open country 0.05.
 */
export function roughnessFromLight(brighteningMag: number | null): number {
  if (brighteningMag == null || !Number.isFinite(brighteningMag)) return 0.1;
  if (brighteningMag >= 4) return 1.0;
  if (brighteningMag >= 3) return 0.7;
  if (brighteningMag >= 1.8) return 0.4;
  if (brighteningMag >= 0.6) return 0.15;
  return 0.05;
}
