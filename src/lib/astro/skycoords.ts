/**
 * Coordinate helpers for the sky's info overlay: galactic coordinates, hour
 * angle and the IAU constellation (Astronomy Engine's boundary lookup).
 */
import * as Astronomy from 'astronomy-engine';

const D2R = Math.PI / 180;

/** J2000 equatorial (degrees) → galactic l, b (degrees), IAU 1958 frame in its J2000 form. */
export function galactic(raDeg: number, decDeg: number): { l: number; b: number } {
  // Rows of the ICRS → galactic rotation (Hipparcos / Liu et al. 2011).
  const M = [
    [-0.0548755604, -0.8734370902, -0.4838350155],
    [0.4941094279, -0.44482963, 0.7469822445],
    [-0.867666149, -0.1980763734, 0.4559837762],
  ] as const;
  const ra = raDeg * D2R;
  const dec = decDeg * D2R;
  const v = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)] as const;
  const g = M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]) as [number, number, number];
  const l = (((Math.atan2(g[1], g[0]) / D2R) % 360) + 360) % 360;
  const b = Math.asin(Math.max(-1, Math.min(1, g[2]))) / D2R;
  return { l, b };
}

/** Local apparent sidereal time, hours 0–24. */
export function localSiderealHours(date: Date, lonDeg: number): number {
  return (((Astronomy.SiderealTime(date) + lonDeg / 15) % 24) + 24) % 24;
}

/** Hour angle in hours, −12 to +12 (negative = east of the meridian, still rising). */
export function hourAngle(date: Date, lonDeg: number, raOfDateDeg: number): number {
  let h = localSiderealHours(date, lonDeg) - raOfDateDeg / 15;
  h = ((h % 24) + 24) % 24;
  return h >= 12 ? h - 24 : h;
}

/** IAU constellation (full name and abbreviation) from J2000 coordinates. */
export function constellationOf(raDeg: number, decDeg: number): { name: string; abbr: string } {
  const c = Astronomy.Constellation(raDeg / 15, decDeg);
  return { name: c.name, abbr: c.symbol };
}

/** "+5h 12m" style formatting of hours (hour angle). */
export function fmtHours(h: number, signed = false): string {
  const s = h < 0 ? '−' : signed ? '+' : '';
  const a = Math.abs(h);
  let hh = Math.floor(a);
  let mm = Math.round((a - hh) * 60);
  if (mm === 60) {
    hh++;
    mm = 0;
  }
  return `${s}${hh}h ${String(mm).padStart(2, '0')}m`;
}

/** Right ascension in degrees → "5h 35m 17.3s". */
export function fmtRA(deg: number): string {
  const h = (((deg / 15) % 24) + 24) % 24;
  let hh = Math.floor(h);
  let mm = Math.floor((h - hh) * 60);
  let ss = Math.round(((h - hh) * 60 - mm) * 600) / 10;
  if (ss >= 60) {
    ss = 0;
    mm++;
  }
  if (mm >= 60) {
    mm = 0;
    hh = (hh + 1) % 24;
  }
  return `${hh}h ${String(mm).padStart(2, '0')}m ${ss.toFixed(1).padStart(4, '0')}s`;
}

/** Signed angle in degrees → "−5° 23′ 28″". */
export function fmtDMS(deg: number): string {
  const a = Math.abs(deg);
  let d = Math.floor(a);
  let m = Math.floor((a - d) * 60);
  let s = Math.round(((a - d) * 60 - m) * 60);
  if (s >= 60) {
    s = 0;
    m++;
  }
  if (m >= 60) {
    m = 0;
    d++;
  }
  return `${deg < 0 ? '−' : '+'}${d}° ${String(m).padStart(2, '0')}′ ${String(s).padStart(2, '0')}″`;
}

/**
 * Sky coordinates typed in the search box, J2000:
 *   "83.82 -5.39" (degrees), "5h35m17.3s -5d23m28s", "05:35:17.3 -05:23:28",
 *   "5 35 17.3 -5 23 28", "RA 5h35.3m Dec -5°23′". RA in degrees unless written
 *   in hours (h, ":" or three parts). Returns degrees, or null.
 */
export function parseRaDec(text: string): { ra: number; dec: number } | null {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/[\u2212\u2013]/g, '-')
    .replace(/\b(ra|dec|de)\b/g, ' ')
    .replace(/[,;]/g, ' ');
  if (!/\d/.test(t) || t.length > 80) return null;
  const hoursMarked = /\d\s*h/.test(t) || /\d:\d/.test(t);
  const tokens = t.replace(/[hdms:°º′'″"]/g, ' ').match(/[+-]?\d+(?:\.\d+)?/g) ?? [];
  const n = tokens.length;
  if (n !== 2 && n !== 4 && n !== 6) return null;
  const half = n / 2;
  const raT = tokens.slice(0, half);
  const deT = tokens.slice(half);
  const sexa = (parts: string[]) =>
    parts.reduce((acc, p, i) => acc + Math.abs(Number(p)) / 60 ** i, 0);
  const raVal = sexa(raT);
  const ra = hoursMarked || half > 1 ? raVal * 15 : raVal;
  const neg = (deT[0] ?? '').startsWith('-');
  const dec = (neg ? -1 : 1) * sexa(deT);
  if (raT.some((p) => p.startsWith('-'))) return null;
  if (!(ra >= 0 && ra < 360) || !(dec >= -90 && dec <= 90)) return null;
  if (half > 1 && raT.slice(1).some((p) => Number(p) >= 60)) return null;
  if (half > 1 && deT.slice(1).some((p) => Number(p) >= 60)) return null;
  return { ra, dec };
}
