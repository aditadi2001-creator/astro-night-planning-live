/**
 * Coordinate helpers for the telescope HUD. Precession + nutation between J2000 and the equator
 * of date come from Astronomy Engine (the same library as the rest of the app). Pure functions,
 * tested in tests/telescope.test.ts.
 */
import * as Astronomy from 'astronomy-engine';
import type { PierSide } from './types';

const D2R = Math.PI / 180;
const wrap360 = (d: number) => ((d % 360) + 360) % 360;
/** Hours in −12…+12. */
export const wrapHours = (h: number) => ((((h + 12) % 24) + 24) % 24) - 12;

function rotate(rot: Astronomy.RotationMatrix, raDeg: number, decDeg: number, date: Date) {
  const v = Astronomy.VectorFromSphere(new Astronomy.Spherical(decDeg, raDeg, 1), date);
  const out = Astronomy.SphereFromVector(Astronomy.RotateVector(rot, v));
  return { ra: wrap360(out.lon), dec: out.lat };
}

/** J2000 → equator and equinox of date (JNow). */
export function j2000ToNow(raDeg: number, decDeg: number, date: Date) {
  return rotate(Astronomy.Rotation_EQJ_EQD(date), raDeg, decDeg, date);
}

/** Equator of date (JNow) → J2000. */
export function nowToJ2000(raDeg: number, decDeg: number, date: Date) {
  return rotate(Astronomy.InverseRotation(Astronomy.Rotation_EQJ_EQD(date)), raDeg, decDeg, date);
}

/** Local apparent sidereal time (hours) at a longitude (degrees east). */
export function localSiderealH(date: Date, lonDeg: number): number {
  return (((Astronomy.SiderealTime(date) + lonDeg / 15) % 24) + 24) % 24;
}

/** Hour angle (hours, −12…+12; negative = east of the meridian) of a JNow RA. */
export function hourAngleH(lstH: number, raNowDeg: number): number {
  return wrapHours(lstH - raNowDeg / 15);
}

/** Altitude/azimuth (degrees) of a JNow position, without refraction. */
export function altAzNow(raNowDeg: number, decNowDeg: number, latDeg: number, lstH: number) {
  const ha = hourAngleH(lstH, raNowDeg) * 15 * D2R;
  const dec = decNowDeg * D2R;
  const lat = latDeg * D2R;
  const sinAlt = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(ha);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const az = Math.atan2(
    -Math.cos(dec) * Math.sin(ha),
    Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(ha),
  );
  return { alt: alt / D2R, az: wrap360(az / D2R) };
}

/** Sidereal hours → solar hours. */
const SIDEREAL = 0.99726957;

/** Hours until the object crosses the meridian (0 when on it, up to ~24 h). */
export function hoursToMeridian(haH: number): number {
  return (haH <= 0 ? -haH : 24 - haH) * SIDEREAL;
}

/**
 * Hours until the position sinks below the horizon (a profile in degrees per azimuth, or flat 0°),
 * searched in 2-minute steps up to 12 h. Null if it stays up (circumpolar) or is already down.
 */
export function hoursToHorizon(
  raNowDeg: number,
  decNowDeg: number,
  latDeg: number,
  lstH: number,
  horizonAt: (azDeg: number) => number = () => 0,
): number | null {
  const now = altAzNow(raNowDeg, decNowDeg, latDeg, lstH);
  if (now.alt < horizonAt(now.az)) return null;
  for (let m = 2; m <= 720; m += 2) {
    const lst = lstH + m / 60 / SIDEREAL;
    const p = altAzNow(raNowDeg, decNowDeg, latDeg, lst);
    if (p.alt < horizonAt(p.az)) return m / 60;
  }
  return null;
}

/**
 * Side of pier for a German equatorial mount in its normal pointing state: looking east (hour
 * angle < 0) the telescope sits on the west side of the pier, after the flip on the east side.
 */
export function expectedPier(haH: number): PierSide {
  return haH < 0 ? 'west' : 'east';
}

/** Angular separation (degrees) and position angle (degrees east of north) from a to b. */
export function separation(ra1: number, dec1: number, ra2: number, dec2: number) {
  const a1 = ra1 * D2R;
  const d1 = dec1 * D2R;
  const a2 = ra2 * D2R;
  const d2 = dec2 * D2R;
  const cos = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(a2 - a1);
  const sep = Math.acos(Math.max(-1, Math.min(1, cos))) / D2R;
  const pa = Math.atan2(
    Math.sin(a2 - a1),
    Math.cos(d1) * Math.tan(d2) - Math.sin(d1) * Math.cos(a2 - a1),
  );
  return { sepDeg: sep, paDeg: wrap360(pa / D2R) };
}

/** "1 h 05 min", "12 min", "n/a". */
export function fmtHours(h: number | null): string {
  if (h == null || !Number.isFinite(h)) return 'n/a';
  const m = Math.round(h * 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
