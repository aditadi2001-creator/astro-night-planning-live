/**
 * Sky brightness added by the Moon: Krisciunas, K. & Schaefer, B. E. (1991),
 * "A model of the brightness of moonlight", PASP 103, 1033–1039.
 *
 *   I*(α)  = 10^(−0.4 (3.84 + 0.026|α| + 4·10⁻⁹ α⁴))           (eq. 20, α in deg)
 *   f(ρ)   = 10^5.36 (1.06 + cos²ρ) + 10^(6.15 − ρ/40)         (eq. 21, ρ in deg)
 *   X(Z)   = (1 − 0.96 sin² Z)^(−1/2)                          (eq. 3)
 *   B_moon = f(ρ) I* 10^(−0.4 k X(Z_m)) [1 − 10^(−0.4 k X(Z))]  (eq. 15, nanoLamberts)
 *
 * α: lunar phase angle (0 = full), ρ: Moon–target separation, Z/Z_m: zenith
 * distances of target and Moon, k: V extinction (mag/airmass). Valid for the
 * Moon above the horizon; the paper quotes ~8–23 % rms accuracy.
 *
 * Conversion between nanoLamberts and V mag/arcsec² (K&S eq. 1 and its
 * inverse, Garstang 1986): B = 34.08 exp(20.7233 − 0.92104 V).
 */

const DEG = Math.PI / 180;

export function nlToMag(bNl: number): number {
  return (20.7233 - Math.log(bNl / 34.08)) / 0.92104;
}

export function magToNl(v: number): number {
  return 34.08 * Math.exp(20.7233 - 0.92104 * v);
}

/** K&S airmass for scattering geometry (eq. 3), zenith distance in degrees. */
export function ksAirmass(zDeg: number): number {
  return 1 / Math.sqrt(1 - 0.96 * Math.sin(zDeg * DEG) ** 2);
}

export interface MoonGeometry {
  /** Lunar phase angle in degrees (0 = full Moon, 180 = new). */
  phaseAngle: number;
  /** Moon altitude in degrees. */
  moonAlt: number;
  /** Target altitude in degrees. */
  targetAlt: number;
  /** Angular separation Moon–target in degrees. */
  separation: number;
}

/** Moonlight sky brightness in nanoLamberts at the target (0 if the Moon is down). */
export function moonSkyBrightness(g: MoonGeometry, k: number): number {
  if (g.moonAlt <= 0 || g.targetAlt <= 0) return 0;
  const a = Math.abs(g.phaseAngle);
  const iStar = 10 ** (-0.4 * (3.84 + 0.026 * a + 4e-9 * a ** 4));
  const rho = Math.max(g.separation, 0.25); // avoid the singular point on the Moon itself
  const f = 10 ** 5.36 * (1.06 + Math.cos(rho * DEG) ** 2) + 10 ** (6.15 - rho / 40);
  const xm = ksAirmass(90 - g.moonAlt);
  const x = ksAirmass(90 - g.targetAlt);
  return f * iStar * 10 ** (-0.4 * k * xm) * (1 - 10 ** (-0.4 * k * x));
}

/** Natural dark-sky zenith brightness used by K&S (Mauna Kea, V). */
export const KS_DARK_SKY_MAG = 21.587;
