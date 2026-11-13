/**
 * Visibility of one target from a site: rise/transit/set, how high it gets in
 * tonight's darkness, airmass and distance from the Moon. Fixed objects use
 * their J2000 position (astronomy-engine applies precession, nutation and
 * aberration); planets, the Sun and the Moon use their own ephemerides.
 */
import * as Astronomy from 'astronomy-engine';
import type { Place } from './sky';
import { airmassKastenYoung } from '../physics/airmass';

export interface TargetRef {
  name: string;
  ra2000: number;
  dec2000: number;
  /** Solar-system body name ("Moon", "Saturn"…) when the target moves. */
  body?: string | null;
}

export interface Visibility {
  altNow: number;
  azNow: number;
  airmassNow: number | null;
  rise: Date | null;
  transit: Date | null;
  transitAlt: number | null;
  set: Date | null;
  /** Never above the horizon / never sets, today. */
  neverRises: boolean;
  circumpolar: boolean;
  /** Highest point during tonight's astronomical darkness (or the night, if no full darkness). */
  bestTonight: { t: Date; alt: number } | null;
  /** Hours above 30° during astronomical darkness tonight. */
  darkHoursAbove30: number;
  /** Angular distance from the Moon now (degrees) and the Moon's illumination. */
  moonSep: number | null;
}

const BODIES: Record<string, Astronomy.Body> = {
  Sun: Astronomy.Body.Sun,
  Moon: Astronomy.Body.Moon,
  Mercury: Astronomy.Body.Mercury,
  Venus: Astronomy.Body.Venus,
  Mars: Astronomy.Body.Mars,
  Jupiter: Astronomy.Body.Jupiter,
  Saturn: Astronomy.Body.Saturn,
  Uranus: Astronomy.Body.Uranus,
  Neptune: Astronomy.Body.Neptune,
  Pluto: Astronomy.Body.Pluto,
};

/** The Solar-system body behind an engine name like "NAME Saturn" or "Saturn". */
export function bodyFor(names: readonly string[]): string | null {
  for (const n of names) {
    const k = n.replace(/^NAME\s+/, '').trim();
    if (k in BODIES) return k;
  }
  return null;
}

function bodyOf(t: TargetRef): Astronomy.Body {
  if (t.body && BODIES[t.body]) return BODIES[t.body] as Astronomy.Body;
  // Fixed object: a user-defined star at its J2000 position (distance only matters for parallax).
  Astronomy.DefineStar(Astronomy.Body.Star1, t.ra2000 / 15, t.dec2000, 1000);
  return Astronomy.Body.Star1;
}

export function altAz(body: Astronomy.Body, obs: Astronomy.Observer, d: Date) {
  const eq = Astronomy.Equator(body, d, obs, true, true);
  const h = Astronomy.Horizon(d, obs, eq.ra, eq.dec, 'normal');
  return { alt: h.altitude, az: h.azimuth };
}

export function targetVisibility(
  t: TargetRef,
  place: Place,
  now: Date,
  dark: { start: Date | null; end: Date | null },
): Visibility {
  const obs = new Astronomy.Observer(place.lat, place.lon, place.elevation);
  const body = bodyOf(t);
  const cur = altAz(body, obs, now);
  // Today's events, searched from 12 h before now so "today" stays stable through the night.
  const from = new Date(now.getTime() - 12 * 3600_000);
  const rise = Astronomy.SearchRiseSet(body, obs, 1, from, 1.5)?.date ?? null;
  const transitEv = Astronomy.SearchHourAngle(body, obs, 0, from);
  const set = Astronomy.SearchRiseSet(body, obs, -1, rise ?? from, 1.5)?.date ?? null;
  const transitAlt = transitEv?.hor.altitude ?? null;
  const neverRises = !rise && !set && (transitAlt ?? -90) < 0;
  const circumpolar = !rise && !set && (transitAlt ?? -90) > 0;

  let bestTonight: Visibility['bestTonight'] = null;
  let darkHoursAbove30 = 0;
  if (dark.start && dark.end && dark.end > dark.start) {
    const step = 10 * 60_000;
    for (let ms = dark.start.getTime(); ms <= dark.end.getTime(); ms += step) {
      const d = new Date(ms);
      const a = altAz(body, obs, d).alt;
      if (!bestTonight || a > bestTonight.alt) bestTonight = { t: d, alt: a };
      if (a >= 30) darkHoursAbove30 += step / 3600_000;
    }
  }

  let moonSep: number | null = null;
  if (t.body !== 'Moon') {
    const m = Astronomy.Equator(Astronomy.Body.Moon, now, obs, true, true);
    const o = Astronomy.Equator(body, now, obs, true, true);
    moonSep = Astronomy.AngleBetween(m.vec, o.vec);
  }

  return {
    altNow: cur.alt,
    azNow: cur.az,
    airmassNow: cur.alt > 0 ? airmassKastenYoung(cur.alt) : null,
    rise,
    transit: transitEv?.time.date ?? null,
    transitAlt,
    set,
    neverRises,
    circumpolar,
    bestTonight,
    darkHoursAbove30: Math.round(darkHoursAbove30 * 10) / 10,
    moonSep,
  };
}

/** Distance from a parallax in milliarcseconds: parsecs and light years. */
export function distanceFromParallax(plxMas: number | null): { pc: number; ly: number } | null {
  if (plxMas == null || !(plxMas > 0.05)) return null;
  const pc = 1000 / plxMas;
  return { pc, ly: pc * 3.26156 };
}

/** Rough spectral class and temperature of a main-sequence star from B−V (Ballesteros 2012). */
export function colourClass(bv: number | null): { cls: string; tempK: number } | null {
  if (bv == null || !Number.isFinite(bv)) return null;
  const b = Math.min(2.0, Math.max(-0.4, bv));
  const tempK = 4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62));
  const cls =
    b < -0.02 ? 'B' : b < 0.3 ? 'A' : b < 0.58 ? 'F' : b < 0.81 ? 'G' : b < 1.4 ? 'K' : 'M';
  return { cls, tempK: Math.round(tempK / 50) * 50 };
}
