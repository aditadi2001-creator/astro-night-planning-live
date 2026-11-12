/**
 * Atmospheric refraction with live temperature / pressure correction.
 *
 * Bennett, G. G. (1982), "The calculation of astronomical refraction in marine
 * navigation", Journal of Navigation 35, 255–259. Input: APPARENT altitude.
 *   R = cot(h_a + 7.31 / (h_a + 4.4))   [arcmin]
 *
 * Saemundsson, T. (1986), Sky & Telescope 72, 70. Input: TRUE (airless) altitude.
 *   R = 1.02 · cot(h + 10.3 / (h + 5.11))   [arcmin]
 *
 * Both are defined for 1010 hPa and 10 °C. For other conditions multiply by
 *   (P / 1010 hPa) · (283 K / (273 K + T))
 * (Meeus, Astronomical Algorithms, 2nd ed., ch. 16).
 */
const DEG = Math.PI / 180;

export interface Atmosphere {
  /** Surface (station) pressure in hPa, not sea-level pressure. */
  pressureHPa: number;
  /** Air temperature in °C. */
  temperatureC: number;
}

export const STANDARD_ATMOSPHERE: Atmosphere = { pressureHPa: 1010, temperatureC: 10 };

/** Pressure/temperature scale factor relative to the formulas' 1010 hPa, 10 °C. */
export function refractionScale(atm: Atmosphere): number {
  return (atm.pressureHPa / 1010) * (283 / (273 + atm.temperatureC));
}

/** Refraction in degrees for an APPARENT altitude (Bennett 1982). */
export function refractionFromApparent(
  apparentAltDeg: number,
  atm: Atmosphere = STANDARD_ATMOSPHERE,
): number {
  if (!Number.isFinite(apparentAltDeg) || apparentAltDeg < -1 || apparentAltDeg > 90) return 0;
  const h = apparentAltDeg;
  let arcmin = 1 / Math.tan((h + 7.31 / (h + 4.4)) * DEG);
  // Meeus's small correction term makes R exactly zero at the zenith.
  arcmin -= 0.06 * Math.sin((14.7 * arcmin + 13) * DEG);
  return Math.max(0, (arcmin / 60) * refractionScale(atm));
}

/** Refraction in degrees for a TRUE (geometric) altitude (Saemundsson 1986). */
export function refractionFromTrue(
  trueAltDeg: number,
  atm: Atmosphere = STANDARD_ATMOSPHERE,
): number {
  if (!Number.isFinite(trueAltDeg) || trueAltDeg < -1.9 || trueAltDeg > 90) return 0;
  const h = trueAltDeg;
  let arcmin = 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * DEG);
  // Constant offset so that R is zero at the zenith, consistent with Bennett.
  arcmin -= 0.0019279;
  return Math.max(0, (arcmin / 60) * refractionScale(atm));
}

/** Apparent altitude of an object whose true (geometric) altitude is given. */
export function apparentAltitude(
  trueAltDeg: number,
  atm: Atmosphere = STANDARD_ATMOSPHERE,
): number {
  return trueAltDeg + refractionFromTrue(trueAltDeg, atm);
}
