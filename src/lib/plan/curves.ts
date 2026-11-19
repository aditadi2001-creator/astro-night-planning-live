/**
 * Altitude curves for charts: a fixed object (J2000 → apparent via Astronomy Engine, standard
 * refraction, the same path as targetVisibility), the Moon, and "best time of year" (hours in
 * astronomical darkness above a minimum altitude, month by month).
 */
import * as Astronomy from 'astronomy-engine';

export interface Site {
  lat: number;
  lon: number;
  elevation: number;
}

export interface CurvePoint {
  t: number;
  alt: number;
  az: number;
}

function curve(
  body: Astronomy.Body,
  site: Site,
  from: number,
  to: number,
  stepMin: number,
): CurvePoint[] {
  const obs = new Astronomy.Observer(site.lat, site.lon, site.elevation);
  const out: CurvePoint[] = [];
  for (let t = from; t <= to; t += stepMin * 60_000) {
    const d = new Date(t);
    const eq = Astronomy.Equator(body, d, obs, true, true);
    const h = Astronomy.Horizon(d, obs, eq.ra, eq.dec, 'normal');
    out.push({ t, alt: h.altitude, az: h.azimuth });
  }
  return out;
}

export function objectCurve(
  ra: number,
  dec: number,
  site: Site,
  from: number,
  to: number,
  stepMin = 10,
): CurvePoint[] {
  Astronomy.DefineStar(Astronomy.Body.Star3, ra / 15, dec, 1000);
  return curve(Astronomy.Body.Star3, site, from, to, stepMin);
}

export function bodyCurve(
  name: string,
  site: Site,
  from: number,
  to: number,
  stepMin = 10,
): CurvePoint[] {
  const body = Astronomy.Body[name as keyof typeof Astronomy.Body] as Astronomy.Body;
  return curve(body, site, from, to, stepMin);
}

/** Horizon altitude (°) at an azimuth from a 720-step profile (0.5° steps), 0 without one. */
export function horizonAlt(profile: ArrayLike<number> | null, az: number): number {
  if (!profile || !profile.length) return 0;
  const i = Math.round((((az % 360) + 360) % 360) / (360 / profile.length)) % profile.length;
  return Math.max(0, profile[i] ?? 0);
}

/**
 * Hours in astronomical darkness above `minAlt` (and the horizon) on the 15th of each month of
 * `year`, starting at local evening. Used for the "best time of year" chart.
 */
export function yearCurve(
  ra: number,
  dec: number,
  site: Site,
  year: number,
  minAlt: number,
  profile: ArrayLike<number> | null = null,
): number[] {
  const obs = new Astronomy.Observer(site.lat, site.lon, site.elevation);
  Astronomy.DefineStar(Astronomy.Body.Star3, ra / 15, dec, 1000);
  const out: number[] = [];
  for (let m = 0; m < 12; m++) {
    // Local noon on the 15th (longitude-based), then the dusk and dawn that follow.
    const noon = new Date(Date.UTC(year, m, 15, 12) - (site.lon / 15) * 3600_000);
    const dusk = Astronomy.SearchAltitude(Astronomy.Body.Sun, obs, -1, noon, 1, -18)?.date;
    const dawn = dusk
      ? Astronomy.SearchAltitude(Astronomy.Body.Sun, obs, 1, dusk, 1, -18)?.date
      : null;
    if (!dusk || !dawn) {
      out.push(0);
      continue;
    }
    let h = 0;
    for (let t = dusk.getTime(); t < dawn.getTime(); t += 30 * 60_000) {
      const d = new Date(t);
      const eq = Astronomy.Equator(Astronomy.Body.Star3, d, obs, true, true);
      const hz = Astronomy.Horizon(d, obs, eq.ra, eq.dec, 'normal');
      if (hz.altitude >= Math.max(minAlt, horizonAlt(profile, hz.azimuth))) h += 0.5;
    }
    out.push(h);
  }
  return out;
}
