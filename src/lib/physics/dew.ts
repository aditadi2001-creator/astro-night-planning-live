/**
 * Dew risk for optics.
 *
 * Dew forms when a surface cools below the dew point. On a clear night,
 * exposed surfaces (telescope tubes, lenses) radiate to the cold sky and run
 * a few degrees below air temperature; wind mixes air and reduces this
 * cooling, clouds block it. So we compare the dew-point spread (T − Td)
 * against an estimated radiative undercooling of the optics:
 *
 *   undercool ≈ 3 °C × (1 − cloud) × wind factor,
 *   wind factor = 1 below 2 m/s, falling to 0.3 at 8 m/s and above.
 *
 * The 3 °C clear-sky figure is the typical net radiative cooling of an
 * exposed surface on a calm night (e.g. Monteith & Unsworth, *Principles of
 * Environmental Physics*, ch. 13). This is a planning heuristic, not a
 * measurement; it is labelled that way in the UI.
 */

export type DewRisk = 'none' | 'low' | 'moderate' | 'high';

/** Magnus–Tetens dew point (°C) over water (Alduchov & Eskridge 1996 constants). */
export function dewPoint(tempC: number, rhPercent: number): number {
  const a = 17.625;
  const b = 243.04;
  const rh = Math.min(100, Math.max(1, rhPercent)) / 100;
  const g = Math.log(rh) + (a * tempC) / (b + tempC);
  return (b * g) / (a - g);
}

export function undercooling(cloudPercent: number, windKmh: number): number {
  const ms = windKmh / 3.6;
  const windFactor = ms <= 2 ? 1 : ms >= 8 ? 0.3 : 1 - (0.7 * (ms - 2)) / 6;
  return 3 * (1 - Math.min(100, Math.max(0, cloudPercent)) / 100) * windFactor;
}

export function dewRisk(
  tempC: number,
  dewPointC: number,
  cloudPercent: number,
  windKmh: number,
): { risk: DewRisk; spread: number; margin: number } {
  const spread = tempC - dewPointC;
  // Margin between where the optics will be and the dew point.
  const margin = spread - undercooling(cloudPercent, windKmh);
  const risk: DewRisk =
    margin <= 0 ? 'high' : margin <= 1.5 ? 'moderate' : margin <= 3 ? 'low' : 'none';
  return { risk, spread, margin };
}
