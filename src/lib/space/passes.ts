/**
 * Satellite passes from CelesTrak orbit data (OMM JSON) with satellite.js (SGP4).
 *
 * A pass is "visible" when, at some moment above MIN_ALT, the satellite is in
 * sunlight while the observer's sky is dark (Sun below −6°). Earth's shadow is
 * modelled as a cylinder (good to a few seconds for low orbits).
 */
import {
  degreesToRadians,
  ecfToLookAngles,
  eciToEcf,
  gstime,
  jday,
  json2satrec,
  propagate,
  sunPos,
  type OMMJsonObjectV3,
  type SatRec,
} from 'satellite.js';

/** Orbit elements as published by CelesTrak (only the fields SGP4 needs). */
export type Omm = OMMJsonObjectV3;

export interface Site {
  lat: number;
  lon: number;
  /** metres */
  elevation: number;
}

export interface PassPoint {
  t: number;
  /** degrees from north */
  az: number;
  /** degrees */
  alt: number;
}

export interface Pass {
  name: string;
  norad: number;
  rise: PassPoint;
  peak: PassPoint;
  set: PassPoint;
  /** Sunlit against a dark sky at some point above MIN_ALT. */
  visible: boolean;
  /** Visible part (when visible): first and last sunlit, dark-sky moments. */
  visibleFrom?: PassPoint;
  visibleTo?: PassPoint;
}

/** Ignore passes that never climb above this (haze, trees, buildings). */
export const MIN_ALT = 10;
/** The sky counts as dark enough to see a satellite below this solar altitude. */
export const SUN_DARK = -6;

const R_EARTH = 6378.137;
const AU_KM = 149_597_870.7;
const RAD = 180 / Math.PI;

interface Sampler {
  look(t: number): { az: number; alt: number; sunlit: boolean; sunAlt: number } | null;
}

function sampler(satrec: SatRec, site: Site): Sampler {
  const obs = {
    latitude: degreesToRadians(site.lat),
    longitude: degreesToRadians(site.lon),
    height: site.elevation / 1000,
  };
  return {
    look(t) {
      const date = new Date(t);
      const pv = propagate(satrec, date) as {
        position?: { x: number; y: number; z: number } | false;
      } | null;
      const p = pv?.position;
      if (!p || !Number.isFinite(p.x)) return null;
      const gmst = gstime(date);
      const la = ecfToLookAngles(obs, eciToEcf(p, gmst));
      // Sun (mean equator of date, AU) – close enough to TEME for shadow and altitude tests.
      const s = sunPos(jday(date)).rsun;
      const sx = (s[0] ?? 0) * AU_KM;
      const sy = (s[1] ?? 0) * AU_KM;
      const sz = (s[2] ?? 0) * AU_KM;
      const sn = Math.hypot(sx, sy, sz);
      const ux = sx / sn;
      const uy = sy / sn;
      const uz = sz / sn;
      const along = p.x * ux + p.y * uy + p.z * uz;
      const px = p.x - along * ux;
      const py = p.y - along * uy;
      const pz = p.z - along * uz;
      const sunlit = along > 0 || Math.hypot(px, py, pz) > R_EARTH;
      const sunLook = ecfToLookAngles(obs, eciToEcf({ x: sx, y: sy, z: sz }, gmst));
      return {
        az: (((la.azimuth * RAD) % 360) + 360) % 360,
        alt: la.elevation * RAD,
        sunlit,
        sunAlt: sunLook.elevation * RAD,
      };
    },
  };
}

/** Bisection for the moment altitude crosses 0 between a (below) and b (above), or the reverse. */
function crossing(s: Sampler, a: number, b: number): number {
  let lo = a;
  let hi = b;
  const loAbove = (s.look(lo)?.alt ?? -90) > 0;
  for (let i = 0; i < 20 && hi - lo > 500; i++) {
    const mid = (lo + hi) / 2;
    const above = (s.look(mid)?.alt ?? -90) > 0;
    if (above === loAbove) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function point(s: Sampler, t: number): PassPoint {
  const l = s.look(t);
  return { t, az: l?.az ?? 0, alt: l?.alt ?? 0 };
}

/**
 * All passes of one satellite between `start` and `end` (ms) peaking above
 * `minAlt`. `stepMs` must be shorter than the shortest pass of interest.
 */
export function findPasses(
  omm: Omm,
  site: Site,
  start: number,
  end: number,
  opts: { stepMs?: number; minAlt?: number } = {},
): Pass[] {
  let satrec: SatRec;
  try {
    satrec = json2satrec(omm);
  } catch {
    return [];
  }
  const s = sampler(satrec, site);
  const step = opts.stepMs ?? 30_000;
  const minAlt = opts.minAlt ?? MIN_ALT;
  const out: Pass[] = [];
  let prev = s.look(start);
  if (!prev) return [];
  let riseT: number | null = prev.alt > 0 ? start : null;
  for (let t = start + step; t <= end + step; t += step) {
    const cur = s.look(t);
    if (!cur) break; // decayed or propagation error
    if (prev.alt <= 0 && cur.alt > 0) riseT = crossing(s, t - step, t);
    if (prev.alt > 0 && cur.alt <= 0 && riseT !== null) {
      const setT = crossing(s, t - step, t);
      const pass = describePass(s, omm, riseT, setT, minAlt);
      if (pass) out.push(pass);
      riseT = null;
    }
    prev = cur;
  }
  return out;
}

function describePass(
  s: Sampler,
  omm: Omm,
  riseT: number,
  setT: number,
  minAlt: number,
): Pass | null {
  // Peak: golden-section search on altitude (single maximum within a pass).
  let a = riseT;
  let b = setT;
  const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 30 && b - a > 1000; i++) {
    const c = b - g * (b - a);
    const d = a + g * (b - a);
    if ((s.look(c)?.alt ?? -90) > (s.look(d)?.alt ?? -90)) b = d;
    else a = c;
  }
  const peak = point(s, (a + b) / 2);
  if (peak.alt < minAlt) return null;

  // Visibility: sample the part above minAlt every 10 s.
  let visibleFrom: PassPoint | undefined;
  let visibleTo: PassPoint | undefined;
  for (let t = riseT; t <= setT; t += 10_000) {
    const l = s.look(t);
    if (!l || l.alt < minAlt) continue;
    if (l.sunlit && l.sunAlt < SUN_DARK) {
      const p = { t, az: l.az, alt: l.alt };
      visibleFrom ??= p;
      visibleTo = p;
    }
  }
  return {
    name: omm.OBJECT_NAME,
    norad: Number(omm.NORAD_CAT_ID),
    rise: point(s, riseT),
    peak,
    set: point(s, setT),
    visible: !!visibleFrom,
    ...(visibleFrom ? { visibleFrom, visibleTo } : {}),
  };
}

/** Space stations shown by name (NORAD catalogue numbers). */
export const STATIONS: Record<number, string> = {
  25544: 'ISS',
  48274: 'Tiangong',
};

/** "NNE" style compass point for an azimuth. */
export function compass16(az: number): string {
  const pts = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
  ];
  return pts[Math.round((((az % 360) + 360) % 360) / 22.5) % 16] ?? 'N';
}
