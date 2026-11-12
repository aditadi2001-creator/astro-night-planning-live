/**
 * Atmospheric extinction in the V band (λ ≈ 0.55 µm), in magnitudes per
 * airmass, from three published components:
 *
 *  Rayleigh: optical depth of the molecular atmosphere, Hansen & Travis (1974),
 *    Space Sci. Rev. 16, 527, eq. 2.29:
 *      τ_R(λ) = 0.008569 λ⁻⁴ (1 + 0.0113 λ⁻² + 0.00013 λ⁻⁴)   (λ in µm, 1013.25 hPa)
 *    scaled linearly with station pressure. τ_R(0.55) = 0.0973, which matches
 *    Bucholtz (1995), Appl. Opt. 34, 2765, Table 2 (0.09728).
 *
 *  Aerosol: CAMS aerosol optical depth at 550 nm, straight from Open-Meteo.
 *    CAMS AOD already includes hygroscopic growth, so humidity is NOT applied
 *    again here.
 *
 *  Ozone (Chappuis band): τ_O3 = σ N, σ(550 nm, 293 K) ≈ 3.3e-21 cm²
 *    (Serdyuchenko et al. 2014, AMT 7, 625), N = DU × 2.687e16 cm⁻².
 *    Open-Meteo has no total-column ozone, so we use a climatological 300 DU.
 *
 *  Magnitudes: Δm = 2.5 log10(e) τ = 1.0857 τ.
 */

const MAG_PER_TAU = 2.5 * Math.LOG10E; // 1.0857
const STD_P = 1013.25;

export const V_WAVELENGTH_UM = 0.55;

export function rayleighTau(lambdaUm = V_WAVELENGTH_UM, pressureHPa = STD_P): number {
  const l2 = lambdaUm ** -2;
  const l4 = lambdaUm ** -4;
  return 0.008569 * l4 * (1 + 0.0113 * l2 + 0.00013 * l4) * (pressureHPa / STD_P);
}

export function ozoneTau(dobson = 300): number {
  return 3.3e-21 * dobson * 2.687e16;
}

export interface ExtinctionParts {
  rayleigh: number;
  aerosol: number;
  ozone: number;
  /** Total zenith extinction k (mag per airmass). */
  total: number;
}

/** Zenith V-band extinction (mag/airmass) from station pressure and AOD at 550 nm. */
export function zenithExtinction(
  pressureHPa: number,
  aod550: number,
  ozoneDU = 300,
): ExtinctionParts {
  const rayleigh = MAG_PER_TAU * rayleighTau(V_WAVELENGTH_UM, pressureHPa);
  const aerosol = MAG_PER_TAU * Math.max(0, aod550);
  const ozone = MAG_PER_TAU * ozoneTau(ozoneDU);
  return { rayleigh, aerosol, ozone, total: rayleigh + aerosol + ozone };
}

export type TransparencyClass = 'excellent' | 'good' | 'average' | 'poor' | 'bad';

/**
 * Plain-language class for zenith extinction. Thresholds: ~0.15 is a very
 * clean high-altitude site (Mauna Kea V ≈ 0.11–0.13, Krisciunas et al. 1987),
 * ~0.25 a clear sea-level night, > 0.5 heavy haze.
 */
export function transparencyClass(k: number): TransparencyClass {
  if (k < 0.18) return 'excellent';
  if (k < 0.25) return 'good';
  if (k < 0.35) return 'average';
  if (k < 0.5) return 'poor';
  return 'bad';
}
