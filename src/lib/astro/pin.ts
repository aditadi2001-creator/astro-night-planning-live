/**
 * Objects the 3D sky has no entry for (Sharpless, Barnard, Lynds, PGC/UGC galaxies, SDSS,
 * SIMBAD results, typed coordinates): a pinned position with the same facts the engine gives
 * for its own objects, so the Info panel, the frame and GoTo work for them too.
 */
import * as Astronomy from 'astronomy-engine';
import type { ObjectInfo } from '../engine/stel';
import type { Place } from './sky';

export interface Pin {
  label: string;
  ra: number;
  dec: number;
  /** Other names to look the object up by (catalog, SIMBAD, Wikipedia). */
  names: string[];
  type: string;
  mag: number | null;
  sizeArcmin: number | null;
}

/** Altitude/azimuth (degrees, refraction included) of a J2000 position at a time and place. */
export function altAzOf(ra: number, dec: number, place: Place, t: Date) {
  Astronomy.DefineStar(Astronomy.Body.Star3, ra / 15, dec, 1000);
  const obs = new Astronomy.Observer(place.lat, place.lon, place.elevation);
  const eq = Astronomy.Equator(Astronomy.Body.Star3, t, obs, true, true);
  const h = Astronomy.Horizon(t, obs, eq.ra, eq.dec, 'normal');
  return { alt: h.altitude, az: h.azimuth, raNow: eq.ra * 15, decNow: eq.dec };
}

/** An engine-style description of a pinned object (unknowns are null, never guessed). */
export function pinInfo(p: Pin, place: Place, t: Date): ObjectInfo {
  const a = altAzOf(p.ra, p.dec, place, t);
  return {
    name: p.label,
    otherNames: p.names.filter((n) => n !== p.label),
    type: p.type,
    vmag: p.mag,
    alt: a.alt,
    az: a.az,
    ra: a.raNow,
    dec: a.decNow,
    ra2000: p.ra,
    dec2000: p.dec,
    model: 'pin',
    typeCode: '',
    distanceAu: null,
    parallaxMas: null,
    bv: null,
    sizeMajor: p.sizeArcmin,
    sizeMinor: null,
    phase: null,
    ids: p.names,
  };
}

/**
 * When to look for an object below the horizon now: within the next 24 h, the dark moment
 * (Sun below −12°) when it stands highest; failing that, its highest moment at all. Null when
 * it never rises at this latitude.
 */
export function nextGoodTime(
  ra: number,
  dec: number,
  place: Place,
  from: Date,
): { t: Date; alt: number; dark: boolean } | null {
  const obs = new Astronomy.Observer(place.lat, place.lon, place.elevation);
  let bestDark: { t: Date; alt: number } | null = null;
  let best: { t: Date; alt: number } | null = null;
  for (let m = 0; m <= 24 * 60; m += 10) {
    const t = new Date(from.getTime() + m * 60_000);
    const { alt } = altAzOf(ra, dec, place, t);
    if (!best || alt > best.alt) best = { t, alt };
    if (alt > 0) {
      const sun = Astronomy.Equator(Astronomy.Body.Sun, t, obs, true, true);
      const sunAlt = Astronomy.Horizon(t, obs, sun.ra, sun.dec, undefined).altitude;
      if (sunAlt < -12 && (!bestDark || alt > bestDark.alt)) bestDark = { t, alt };
    }
  }
  if (bestDark) return { ...bestDark, dark: true };
  if (best && best.alt > 0) return { ...best, dark: false };
  return null;
}
