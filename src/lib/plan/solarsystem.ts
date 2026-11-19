/**
 * Planets, Sun and Moon tonight (Astronomy Engine; topocentric, aberration-corrected, standard
 * refraction for altitudes — the same paths as the rest of the app).
 *
 * Apparent diameters use the IAU equatorial radii (km): Sun 695,700 · Mercury 2,439.7 ·
 * Venus 6,051.8 · Mars 3,396.2 · Jupiter 71,492 · Saturn 60,268 · Uranus 25,559 ·
 * Neptune 24,764 · Moon 1,737.4.
 */
import * as Astronomy from 'astronomy-engine';

export const RADIUS_KM: Record<string, number> = {
  Sun: 695_700,
  Moon: 1_737.4,
  Mercury: 2_439.7,
  Venus: 6_051.8,
  Mars: 3_396.2,
  Jupiter: 71_492,
  Saturn: 60_268,
  Uranus: 25_559,
  Neptune: 24_764,
};
const AU_KM = 149_597_870.7;

export interface Site {
  lat: number;
  lon: number;
  elevation: number;
}

export interface BodyNow {
  name: string;
  alt: number;
  az: number;
  ra: number;
  dec: number;
  distAu: number;
  /** Apparent diameter, arcseconds. */
  diameter: number;
  mag: number | null;
  /** Illuminated fraction 0–1. */
  phase: number | null;
  /** Angle from the Sun, degrees. */
  elongation: number | null;
  rise: Date | null;
  transit: { t: Date; alt: number } | null;
  set: Date | null;
}

const body = (name: string) =>
  Astronomy.Body[name as keyof typeof Astronomy.Body] as Astronomy.Body;

export function bodyNow(name: string, site: Site, at: Date): BodyNow {
  const b = body(name);
  const obs = new Astronomy.Observer(site.lat, site.lon, site.elevation);
  const eq = Astronomy.Equator(b, at, obs, true, true);
  const hz = Astronomy.Horizon(at, obs, eq.ra, eq.dec, 'normal');
  const from = new Date(at.getTime() - 12 * 3600_000);
  const rise = Astronomy.SearchRiseSet(b, obs, 1, from, 1.5)?.date ?? null;
  const set = Astronomy.SearchRiseSet(b, obs, -1, rise ?? from, 1.5)?.date ?? null;
  const ha = Astronomy.SearchHourAngle(b, obs, 0, from);
  let mag: number | null = null;
  let phase: number | null = null;
  if (name !== 'Sun') {
    const ill = Astronomy.Illumination(b, at);
    mag = ill.mag;
    phase = ill.phase_fraction;
  }
  const elongation = name === 'Sun' ? null : Astronomy.AngleFromSun(b, at);
  const r = RADIUS_KM[name] ?? 0;
  const diameter = (2 * Math.atan(r / (eq.dist * AU_KM)) * 180 * 3600) / Math.PI;
  return {
    name,
    alt: hz.altitude,
    az: hz.azimuth,
    ra: eq.ra * 15,
    dec: eq.dec,
    distAu: eq.dist,
    diameter,
    mag,
    phase,
    elongation,
    rise,
    transit: { t: ha.time.date, alt: ha.hor.altitude },
    set,
  };
}

/** Best moment tonight between two times: highest altitude, sampled every 10 min. */
export function bestBetween(
  name: string,
  site: Site,
  from: number,
  to: number,
): { t: number; alt: number } | null {
  const b = body(name);
  const obs = new Astronomy.Observer(site.lat, site.lon, site.elevation);
  let best: { t: number; alt: number } | null = null;
  for (let t = from; t <= to; t += 600_000) {
    const d = new Date(t);
    const eq = Astronomy.Equator(b, d, obs, true, true);
    const alt = Astronomy.Horizon(d, obs, eq.ra, eq.dec, 'normal').altitude;
    if (!best || alt > best.alt) best = { t, alt };
  }
  return best && best.alt > 0 ? best : null;
}

/** Jupiter's Galilean moons: offset from Jupiter in Jupiter radii (+ = east, + = north) and in front/behind. */
export function jupiterMoons(at: Date): { name: string; x: number; y: number; behind: boolean }[] {
  const jm = Astronomy.JupiterMoons(at);
  // Vectors are equatorial J2000 offsets from Jupiter (AU). Project onto the sky as seen from Earth.
  const jv = Astronomy.GeoVector(Astronomy.Body.Jupiter, at, true);
  const d = Math.hypot(jv.x, jv.y, jv.z);
  const los = { x: jv.x / d, y: jv.y / d, z: jv.z / d };
  // East = d(RA) direction, north = d(Dec) direction at Jupiter's position.
  const ra = Math.atan2(los.y, los.x);
  const dec = Math.asin(los.z);
  const east = { x: -Math.sin(ra), y: Math.cos(ra), z: 0 };
  const north = {
    x: -Math.sin(dec) * Math.cos(ra),
    y: -Math.sin(dec) * Math.sin(ra),
    z: Math.cos(dec),
  };
  const RJ_AU = 71_492 / AU_KM;
  const out = [];
  for (const [name, s] of [
    ['Io', jm.io],
    ['Europa', jm.europa],
    ['Ganymede', jm.ganymede],
    ['Callisto', jm.callisto],
  ] as const) {
    const v = { x: s.x, y: s.y, z: s.z };
    out.push({
      name,
      x: (v.x * east.x + v.y * east.y + v.z * east.z) / RJ_AU,
      y: (v.x * north.x + v.y * north.y + v.z * north.z) / RJ_AU,
      behind: v.x * los.x + v.y * los.y + v.z * los.z > 0,
    });
  }
  return out;
}

export function saturnRingTilt(at: Date): number {
  return Astronomy.Illumination(Astronomy.Body.Saturn, at).ring_tilt ?? 0;
}

// ---- the Moon -------------------------------------------------------------------------------

export interface MoonInfo {
  /** Moon−Sun ecliptic longitude difference: 0 new, 90 first quarter, 180 full, 270 last quarter. */
  phaseAngle: number;
  phaseName: string;
  illum: number;
  /** Days since the last new Moon. */
  ageDays: number;
  libration: { lat: number; lon: number };
  next: { name: string; t: Date }[];
  /** Selenographic longitude (°, east +) of the terminator, approximate (libration ignored). */
  terminatorLon: number;
  terminator: 'sunrise' | 'sunset';
}

const QUARTER = ['New Moon', 'First quarter', 'Full Moon', 'Last quarter'];

export function moonInfo(at: Date): MoonInfo {
  const phaseAngle = Astronomy.MoonPhase(at);
  const illum = Astronomy.Illumination(Astronomy.Body.Moon, at).phase_fraction;
  const lastNew = Astronomy.SearchMoonPhase(0, new Date(at.getTime() - 30 * 86400_000), 31);
  let newT = lastNew?.date ?? null;
  // SearchMoonPhase finds the first new Moon after the start: step forward until past `at`.
  while (newT) {
    const nxt =
      Astronomy.SearchMoonPhase(0, new Date(newT.getTime() + 86400_000), 31)?.date ?? null;
    if (!nxt || nxt > at) break;
    newT = nxt;
  }
  const ageDays = newT ? (at.getTime() - newT.getTime()) / 86400_000 : Number.NaN;
  const lib = Astronomy.Libration(at);
  const next: MoonInfo['next'] = [];
  let q = Astronomy.SearchMoonQuarter(at);
  for (let i = 0; i < 4; i++) {
    next.push({ name: QUARTER[q.quarter] ?? '', t: q.time.date });
    q = Astronomy.NextMoonQuarter(q);
  }
  const waxing = phaseAngle < 180;
  const phaseName =
    phaseAngle < 6 || phaseAngle > 354
      ? 'New Moon'
      : phaseAngle < 84
        ? 'Waxing crescent'
        : phaseAngle < 96
          ? 'First quarter'
          : phaseAngle < 174
            ? 'Waxing gibbous'
            : phaseAngle < 186
              ? 'Full Moon'
              : phaseAngle < 264
                ? 'Waning gibbous'
                : phaseAngle < 276
                  ? 'Last quarter'
                  : 'Waning crescent';
  return {
    phaseAngle,
    phaseName,
    illum,
    ageDays,
    libration: { lat: lib.elat, lon: lib.elon },
    next,
    terminatorLon: waxing ? 90 - phaseAngle : 270 - phaseAngle,
    terminator: waxing ? 'sunrise' : 'sunset',
  };
}

/**
 * Well-known lunar features with selenographic coordinates (° east +, ° north +), rounded from
 * the IAU Gazetteer of Planetary Nomenclature. Used to say what is on the terminator tonight.
 */
export const LUNAR_FEATURES: { name: string; lon: number; lat: number; kind: string }[] = [
  { name: 'Copernicus', lon: -20.1, lat: 9.6, kind: 'crater' },
  { name: 'Tycho', lon: -11.2, lat: -43.3, kind: 'crater' },
  { name: 'Plato', lon: -9.3, lat: 51.6, kind: 'crater' },
  { name: 'Clavius', lon: -14.1, lat: -58.6, kind: 'crater' },
  { name: 'Aristarchus', lon: -47.5, lat: 23.7, kind: 'crater' },
  { name: 'Kepler', lon: -38.0, lat: 8.1, kind: 'crater' },
  { name: 'Gassendi', lon: -40.0, lat: -17.6, kind: 'crater' },
  { name: 'Theophilus', lon: 26.4, lat: -11.4, kind: 'crater' },
  { name: 'Cyrillus', lon: 24.0, lat: -13.2, kind: 'crater' },
  { name: 'Catharina', lon: 23.6, lat: -18.0, kind: 'crater' },
  { name: 'Petavius', lon: 60.4, lat: -25.3, kind: 'crater' },
  { name: 'Langrenus', lon: 61.1, lat: -8.9, kind: 'crater' },
  { name: 'Posidonius', lon: 29.9, lat: 31.8, kind: 'crater' },
  { name: 'Archimedes', lon: -4.0, lat: 29.7, kind: 'crater' },
  { name: 'Eratosthenes', lon: -11.3, lat: 14.5, kind: 'crater' },
  { name: 'Ptolemaeus', lon: -1.9, lat: -9.2, kind: 'crater' },
  { name: 'Alphonsus', lon: -3.2, lat: -13.4, kind: 'crater' },
  { name: 'Arzachel', lon: -1.9, lat: -18.3, kind: 'crater' },
  { name: 'Walter', lon: 0.7, lat: -33.0, kind: 'crater' },
  { name: 'Maurolycus', lon: 14.0, lat: -41.8, kind: 'crater' },
  { name: 'Longomontanus', lon: -21.8, lat: -49.6, kind: 'crater' },
  { name: 'Janssen', lon: 41.5, lat: -45.4, kind: 'crater' },
  { name: 'Atlas', lon: 44.4, lat: 46.7, kind: 'crater' },
  { name: 'Endymion', lon: 56.5, lat: 53.6, kind: 'crater' },
  { name: 'Grimaldi', lon: -68.3, lat: -5.2, kind: 'crater' },
  { name: 'Schickard', lon: -54.6, lat: -44.4, kind: 'crater' },
  { name: 'Rupes Recta (Straight Wall)', lon: -7.7, lat: -22.1, kind: 'scarp' },
  { name: 'Montes Apenninus', lon: -3.7, lat: 18.9, kind: 'mountains' },
  { name: 'Vallis Alpes (Alpine Valley)', lon: 3.2, lat: 48.5, kind: 'valley' },
  { name: 'Sinus Iridum (Bay of Rainbows)', lon: -31.7, lat: 44.1, kind: 'bay' },
  { name: 'Mare Crisium', lon: 59.1, lat: 17.0, kind: 'mare' },
  { name: 'Mare Serenitatis', lon: 17.5, lat: 28.0, kind: 'mare' },
  { name: 'Mare Tranquillitatis', lon: 31.4, lat: 8.5, kind: 'mare' },
];

/** Features within `band` degrees of the terminator, nearest first. */
export function onTerminator(info: MoonInfo, band = 8): typeof LUNAR_FEATURES {
  if (info.illum < 0.03 || info.illum > 0.97) return [];
  return LUNAR_FEATURES.filter((f) => Math.abs(f.lon - info.terminatorLon) <= band).sort(
    (a, b) => Math.abs(a.lon - info.terminatorLon) - Math.abs(b.lon - info.terminatorLon),
  );
}

/**
 * Capture advice for a planet with a profile: image scale, critical-sampling f-ratio
 * (≈ 5 × pixel size µm, the usual rule for lucky imaging at 550 nm), and seeing-dependent tips.
 */
export function planetCapture(
  diameterArcsec: number,
  pixelScale: number,
  fRatio: number,
  pixelUm: number,
  seeing: number | null,
  myFilters: string[],
): string[] {
  const px = diameterArcsec / pixelScale;
  const ideal = 5 * pixelUm;
  const tips = [`Disc ≈ ${Math.round(px)} px across at ${pixelScale.toFixed(3)}″/px.`];
  if (px > 20)
    tips.push(
      `Use a region of interest about ${Math.max(320, Math.ceil((px * 2.5) / 32) * 32)} px wide to raise the frame rate.`,
    );
  if (fRatio < ideal * 0.8)
    tips.push(
      `Critical sampling wants about f/${ideal.toFixed(0)}; you are at f/${fRatio.toFixed(1)} (a ${(ideal / fRatio).toFixed(1)}× Barlow would match it).`,
    );
  else tips.push(`f/${fRatio.toFixed(1)} is near critical sampling (≈ f/${ideal.toFixed(0)}).`);
  if (seeing != null && seeing > 2 && myFilters.includes('irpass'))
    tips.push(`Seeing ≈ ${seeing.toFixed(1)}″: the IR-pass filter steadies the image.`);
  tips.push('Short exposures (5–15 ms), thousands of frames, stack the best 10–25 %.');
  return tips;
}
