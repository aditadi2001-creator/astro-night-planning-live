/**
 * Checks before every GoTo (CLAUDE.md rule 8): a slew is refused near the Sun unless the user
 * confirms a certified full-aperture solar filter, refused below the true horizon, and warned
 * about below the user's own horizon or right at the meridian (a flip will follow).
 */
export interface GotoCheck {
  /** Why the slew cannot go ahead (null when it can). */
  blocked: string | null;
  /** Things to know before confirming. */
  warnings: string[];
  /** The Sun is close: the confirmation must include the solar-filter tick. */
  needsSolarFilter: boolean;
}

export const SUN_KEEP_OUT_DEG = 15;

export function gotoCheck(o: {
  /** Target altitude now (degrees, refraction-free is fine). */
  alt: number;
  /** The user's horizon altitude at the target's azimuth (0 when flat). */
  horizonAlt: number;
  /** Angle between the target and the Sun (degrees). */
  sunSepDeg: number;
  /** Sun altitude (degrees). */
  sunAlt: number;
  /** Target hour angle (hours, negative east of the meridian). */
  haH: number;
  /** The user ticked "I have a certified full-aperture solar filter fitted". */
  solarFilter: boolean;
}): GotoCheck {
  const warnings: string[] = [];
  let blocked: string | null = null;
  const nearSun = o.sunAlt > -6 && o.sunSepDeg < SUN_KEEP_OUT_DEG;
  if (nearSun && !o.solarFilter)
    blocked = `It is ${o.sunSepDeg.toFixed(0)}° from the Sun. Never point a telescope near the Sun without a certified full-aperture solar filter on the front.`;
  if (!blocked && o.alt < 0)
    blocked = `It is ${(-o.alt).toFixed(0)}° below the horizon: the telescope could hit the tripod or pier.`;
  if (o.alt >= 0 && o.alt < o.horizonAlt)
    warnings.push(`It is behind your horizon (trees or buildings at ${o.horizonAlt.toFixed(0)}°).`);
  if (o.alt >= 0 && o.alt < 15) warnings.push('It is low (under 15°): poor seeing and haze.');
  if (Math.abs(o.haH) < 0.25)
    warnings.push(
      `It ${o.haH < 0 ? 'crosses' : 'just crossed'} the meridian${o.haH < 0 ? ` in ${Math.round(-o.haH * 60)} min` : ''}: expect a meridian flip.`,
    );
  return { blocked, warnings, needsSolarFilter: nearSun };
}
