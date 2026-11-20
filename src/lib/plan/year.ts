/**
 * Planning months and years ahead (trips): for every night of a year, the hours of
 * astronomical darkness, how many of them are moonless, and (for a chosen target) the hours it
 * stands above a minimum altitude in that darkness; plus the year's events (new and full
 * moons, eclipses, oppositions, meteor-shower peaks). Pure functions; runs in a Web Worker.
 *
 * Method: Sun −18° crossings by Astronomy Engine's SearchAltitude; Moon (topocentric) and
 * target altitudes sampled every 15 minutes, the Moon's apparent RA/Dec computed hourly and
 * interpolated. Moon "up" = centre above the horizon (refraction ignored, ±2 min).
 */
import * as Astronomy from 'astronomy-engine';

export interface Site {
  lat: number;
  lon: number;
  elevation: number;
}

export interface YearTarget {
  name: string;
  /** J2000 degrees. */
  ra: number;
  dec: number;
}

export interface NightRow {
  /** Calendar date of the evening (local to the site's longitude), "YYYY-MM-DD". */
  date: string;
  darkStart: number | null;
  darkEnd: number | null;
  /** Hours of astronomical darkness (Sun below −18°). */
  darkH: number;
  /** Of those, hours with the Moon below the horizon. */
  moonlessH: number;
  /** Moon illuminated fraction at the middle of the night (0–1). */
  moonIllum: number;
  /** Target above `minAlt` in darkness, and in moonless darkness (null without a target). */
  targetH: number | null;
  targetMoonlessH: number | null;
  /** Target's highest altitude during darkness (degrees). */
  targetMaxAlt: number | null;
}

const D = Math.PI / 180;
const STEP_MIN = 15;

/** Local sidereal time (degrees) at a UTC time and east longitude. */
function lstDeg(t: Date, lon: number): number {
  return (Astronomy.SiderealTime(t) * 15 + lon + 360) % 360;
}
function altOf(raDeg: number, decDeg: number, lat: number, lst: number): number {
  const h = (lst - raDeg) * D;
  const s =
    Math.sin(lat * D) * Math.sin(decDeg * D) +
    Math.cos(lat * D) * Math.cos(decDeg * D) * Math.cos(h);
  return Math.asin(Math.max(-1, Math.min(1, s))) / D;
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Target J2000 → position of date (precession and nutation, once per year is enough). */
function ofDate(t: YearTarget, mid: Date) {
  Astronomy.DefineStar(Astronomy.Body.Star4, t.ra / 15, t.dec, 1000);
  const obs = new Astronomy.Observer(0, 0, 0);
  const eq = Astronomy.Equator(Astronomy.Body.Star4, mid, obs, true, false);
  return { ra: eq.ra * 15, dec: eq.dec };
}

/** One night, the evening of `date` (UTC calendar date taken as the local one). */
export function nightAt(
  y: number,
  m: number,
  d: number,
  site: Site,
  target: { ra: number; dec: number } | null,
  minAlt: number,
): NightRow {
  const obs = new Astronomy.Observer(site.lat, site.lon, site.elevation);
  // Local solar noon of that date, in UTC.
  const noon = new Date(Date.UTC(y, m, d, 12) - (site.lon / 15) * 3600_000);
  const date = ymd(new Date(Date.UTC(y, m, d)));
  const s0 = Astronomy.SearchAltitude(Astronomy.Body.Sun, obs, -1, noon, 1, -18);
  const s1 = s0 ? Astronomy.SearchAltitude(Astronomy.Body.Sun, obs, +1, s0.date, 1, -18) : null;
  const midT =
    s0 && s1
      ? new Date((s0.date.getTime() + s1.date.getTime()) / 2)
      : new Date(noon.getTime() + 12 * 3600_000);
  const moonIllum = Astronomy.Illumination(Astronomy.Body.Moon, midT).phase_fraction;
  const base: NightRow = {
    date,
    darkStart: s0?.date.getTime() ?? null,
    darkEnd: s1?.date.getTime() ?? null,
    darkH: 0,
    moonlessH: 0,
    moonIllum,
    targetH: target ? 0 : null,
    targetMoonlessH: target ? 0 : null,
    targetMaxAlt: null,
  };
  if (!s0 || !s1) return base;
  const t0 = s0.date.getTime();
  const t1 = s1.date.getTime();
  // Moon RA/Dec of date (topocentric) every hour, interpolated between.
  const moonAt: { t: number; ra: number; dec: number }[] = [];
  for (let t = t0 - 3600_000; t <= t1 + 3600_000; t += 3600_000) {
    const e = Astronomy.Equator(Astronomy.Body.Moon, new Date(t), obs, true, true);
    moonAt.push({ t, ra: e.ra * 15, dec: e.dec });
  }
  const moonPos = (t: number) => {
    const i = Math.min(
      moonAt.length - 2,
      Math.max(0, Math.floor((t - (moonAt[0]?.t ?? t)) / 3600_000)),
    );
    const a = moonAt[i] as { t: number; ra: number; dec: number };
    const b = moonAt[i + 1] as { t: number; ra: number; dec: number };
    const f = (t - a.t) / 3600_000;
    let dra = b.ra - a.ra;
    if (dra > 180) dra -= 360;
    if (dra < -180) dra += 360;
    return { ra: a.ra + dra * f, dec: a.dec + (b.dec - a.dec) * f };
  };
  const step = STEP_MIN * 60_000;
  let dark = 0;
  let moonless = 0;
  let tH = 0;
  let tMl = 0;
  let tMax = -90;
  for (let t = t0 + step / 2; t < t1; t += step) {
    const w = Math.min(step, t1 - (t - step / 2)) / 3600_000;
    const lst = lstDeg(new Date(t), site.lon);
    const mp = moonPos(t);
    const moonUp = altOf(mp.ra, mp.dec, site.lat, lst) > 0;
    dark += w;
    if (!moonUp) moonless += w;
    if (target) {
      const a = altOf(target.ra, target.dec, site.lat, lst);
      tMax = Math.max(tMax, a);
      if (a >= minAlt) {
        tH += w;
        if (!moonUp) tMl += w;
      }
    }
  }
  return {
    ...base,
    darkH: dark,
    moonlessH: moonless,
    targetH: target ? tH : null,
    targetMoonlessH: target ? tMl : null,
    targetMaxAlt: target ? tMax : null,
  };
}

/** Every night of a year (evenings 1 Jan … 31 Dec). */
export function yearNights(
  year: number,
  site: Site,
  target: YearTarget | null,
  minAlt = 30,
): NightRow[] {
  const t = target ? ofDate(target, new Date(Date.UTC(year, 6, 1))) : null;
  const out: NightRow[] = [];
  for (let m = 0; m < 12; m++) {
    const days = new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
    for (let d = 1; d <= days; d++) out.push(nightAt(year, m, d, site, t, minAlt));
  }
  return out;
}

// ---- events -------------------------------------------------------------------------------

export type EventKind =
  'new-moon' | 'full-moon' | 'lunar-eclipse' | 'solar-eclipse' | 'opposition' | 'meteors';

export interface YearEvent {
  t: number;
  kind: EventKind;
  title: string;
  detail: string;
}

/**
 * Meteor-shower peaks (IMO working list; the date moves by about a day from year to year, so
 * these are "around" dates) with the zenithal hourly rate under ideal skies.
 */
export const METEOR_SHOWERS: { name: string; month: number; day: number; zhr: number }[] = [
  { name: 'Quadrantids', month: 0, day: 3, zhr: 80 },
  { name: 'Lyrids', month: 3, day: 22, zhr: 18 },
  { name: 'Eta Aquariids', month: 4, day: 6, zhr: 50 },
  { name: 'Southern Delta Aquariids', month: 6, day: 30, zhr: 25 },
  { name: 'Perseids', month: 7, day: 12, zhr: 100 },
  { name: 'Orionids', month: 9, day: 21, zhr: 20 },
  { name: 'Leonids', month: 10, day: 17, zhr: 15 },
  { name: 'Geminids', month: 11, day: 14, zhr: 150 },
  { name: 'Ursids', month: 11, day: 22, zhr: 10 },
];

const PLANETS = [
  Astronomy.Body.Mars,
  Astronomy.Body.Jupiter,
  Astronomy.Body.Saturn,
  Astronomy.Body.Uranus,
  Astronomy.Body.Neptune,
];

export function yearEvents(year: number, site: Site): YearEvent[] {
  const obs = new Astronomy.Observer(site.lat, site.lon, site.elevation);
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1)).getTime();
  const out: YearEvent[] = [];
  const moonAlt = (t: Date) => {
    const e = Astronomy.Equator(Astronomy.Body.Moon, t, obs, true, true);
    return Astronomy.Horizon(t, obs, e.ra, e.dec, undefined).altitude;
  };
  for (const [lon, kind, title] of [
    [0, 'new-moon', 'New Moon'],
    [180, 'full-moon', 'Full Moon'],
  ] as const) {
    let t: Astronomy.AstroTime | null = Astronomy.SearchMoonPhase(lon, start, 40);
    while (t && t.date.getTime() < end) {
      out.push({
        t: t.date.getTime(),
        kind,
        title,
        detail:
          kind === 'new-moon'
            ? 'Darkest nights are the few around it.'
            : 'Bright sky all night: narrowband or planets.',
      });
      t = Astronomy.SearchMoonPhase(lon, new Date(t.date.getTime() + 86400_000), 40);
    }
  }
  let le = Astronomy.SearchLunarEclipse(start);
  while (le.peak.date.getTime() < end) {
    const alt = moonAlt(le.peak.date);
    out.push({
      t: le.peak.date.getTime(),
      kind: 'lunar-eclipse',
      title: `${le.kind[0]?.toUpperCase()}${le.kind.slice(1)} lunar eclipse`,
      detail:
        alt > 0
          ? `Visible here (Moon ${Math.round(alt)}° up at mid-eclipse).`
          : 'Not visible here: the Moon is below the horizon at mid-eclipse.',
    });
    le = Astronomy.NextLunarEclipse(le.peak);
  }
  let se = Astronomy.SearchLocalSolarEclipse(start, obs);
  while (se.peak.time.date.getTime() < end) {
    if (se.peak.altitude > 0)
      out.push({
        t: se.peak.time.date.getTime(),
        kind: 'solar-eclipse',
        title: `${se.kind[0]?.toUpperCase()}${se.kind.slice(1)} solar eclipse here`,
        detail: `${Math.round(se.obscuration * 100)} % of the Sun covered, Sun ${Math.round(se.peak.altitude)}° up. Never look at or image the Sun without a certified full-aperture solar filter.`,
      });
    se = Astronomy.NextLocalSolarEclipse(se.peak.time, obs);
  }
  for (const b of PLANETS) {
    let t = Astronomy.SearchRelativeLongitude(b, 0, start);
    // Relative longitude 0 = opposition for an outer planet.
    while (t.date.getTime() < end) {
      out.push({
        t: t.date.getTime(),
        kind: 'opposition',
        title: `${b} at opposition`,
        detail: 'Closest and brightest, up all night: the best weeks for it.',
      });
      t = Astronomy.SearchRelativeLongitude(b, 0, new Date(t.date.getTime() + 30 * 86400_000));
    }
  }
  for (const m of METEOR_SHOWERS) {
    const t = new Date(Date.UTC(year, m.month, m.day, 22) - (site.lon / 15) * 3600_000);
    const illum = Astronomy.Illumination(Astronomy.Body.Moon, t).phase_fraction;
    out.push({
      t: t.getTime(),
      kind: 'meteors',
      title: `${m.name} peak (around this night)`,
      detail: `Up to ${m.zhr} meteors an hour under ideal dark skies; Moon ${Math.round(illum * 100)} % lit.`,
    });
  }
  return out.sort((a, b) => a.t - b.t);
}
