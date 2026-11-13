/**
 * Aurora chance from NOAA SWPC (public domain, no key):
 * - OVATION Prime 30–90 minute forecast: probability (%) of visible aurora on a
 *   1°×1° grid. About 0.9 MB, so it is fetched only where aurora is plausible
 *   and reduced to a few numbers for the site before caching.
 * - Planetary Kp index (observed + 3-day forecast, ~7 KB) for everyone.
 */
import { fetchJson, roundCoord, type Cached } from '../data/cache';

export const OVATION_URL = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json';
export const KP_URL =
  'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json';

/** OVATION is fetched only poleward of this latitude (degrees, either hemisphere). */
export const AURORA_MIN_LAT = 40;

const R_EARTH = 6371;
/** Lower edge of typical aurora (km). Taller rays reach 200–300 km and show from further away. */
export const AURORA_HEIGHT = 110;
/** Aurora lower than this above the horizon is lost in haze and terrain. */
export const MIN_ELEVATION = 5;
/** OVATION values below this are background noise (NOAA's map starts showing colour near 10 %). */
export const MIN_CHANCE = 5;

export interface OvationRaw {
  'Observation Time': string;
  'Forecast Time': string;
  coordinates: [number, number, number][];
}

export interface AuroraSite {
  observed: number;
  forecast: number;
  /** Probability of aurora overhead at the site (%). */
  overhead: number;
  /** Best chance of aurora seen at least MIN_ELEVATION above the horizon (null = none of MIN_CHANCE % or more). */
  best: { chance: number; bearing: number; elevation: number; distanceKm: number } | null;
}

/** Elevation (degrees) of a point at `heightKm` above the ground, `distKm` away along the surface. */
export function elevationOf(distKm: number, heightKm = AURORA_HEIGHT): number {
  const t = distKm / R_EARTH;
  if (t < 1e-9) return 90;
  const k = R_EARTH / (R_EARTH + heightKm);
  return (Math.atan2(Math.cos(t) - k, Math.sin(t)) * 180) / Math.PI;
}

const rad = Math.PI / 180;

/** Great-circle distance (km) and initial bearing (degrees from north). */
export function distBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): { km: number; bearing: number } {
  const p1 = lat1 * rad;
  const p2 = lat2 * rad;
  const dl = (lon2 - lon1) * rad;
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const km = 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  const bearing = (((Math.atan2(y, x) / rad) % 360) + 360) % 360;
  return { km, bearing };
}

/** Reduce the global OVATION grid to what the site can see. */
export function auroraForSite(raw: OvationRaw, lat: number, lon: number): AuroraSite {
  const grid = new Uint8Array(360 * 181);
  for (const c of raw.coordinates) {
    const [lo, la, v] = c;
    const i = ((((Math.round(lo) % 360) + 360) % 360) * 181 + (Math.round(la) + 90)) | 0;
    if (i >= 0 && i < grid.length) grid[i] = Math.max(0, Math.min(100, v));
  }
  const at = (la: number, lo: number) =>
    grid[((((lo % 360) + 360) % 360) * 181 + Math.max(-90, Math.min(90, la)) + 90) | 0] ?? 0;

  const overhead = at(Math.round(lat), Math.round(lon));
  // Horizon distance for the lower edge is ~1170 km; scan a box a bit larger.
  const span = 12;
  let best: AuroraSite['best'] = null;
  for (let la = Math.round(lat) - span; la <= Math.round(lat) + span; la++) {
    if (la < -90 || la > 90) continue;
    const cosLa = Math.max(0.05, Math.cos(la * rad));
    const lonSpan = Math.min(180, Math.ceil(span / cosLa));
    for (let d = -lonSpan; d <= lonSpan; d++) {
      const lo = Math.round(lon) + d;
      const chance = at(la, lo);
      if (chance < MIN_CHANCE || (best && chance < best.chance)) continue;
      const { km, bearing } = distBearing(lat, lon, la, lo);
      const elevation = elevationOf(km);
      if (elevation < MIN_ELEVATION) continue;
      if (!best || chance > best.chance || elevation > best.elevation) {
        best = { chance, bearing, elevation, distanceKm: km };
      }
    }
  }
  return {
    observed: Date.parse(raw['Observation Time']),
    forecast: Date.parse(raw['Forecast Time']),
    overhead,
    best,
  };
}

export interface KpPoint {
  t: number;
  kp: number;
  kind: 'observed' | 'estimated' | 'predicted';
}

type KpRaw = { time_tag: string; kp: number; observed: string }[] | (string | number | null)[][]; // older format: header row + arrays

/** Parse SWPC's Kp product (both the object and the older array format). */
export function parseKp(raw: KpRaw): KpPoint[] {
  const out: KpPoint[] = [];
  for (const row of raw as unknown[]) {
    let tag: unknown, kp: unknown, kind: unknown;
    if (Array.isArray(row)) [tag, kp, kind] = row;
    else if (row && typeof row === 'object') {
      const o = row as Record<string, unknown>;
      tag = o.time_tag;
      kp = o.kp;
      kind = o.observed;
    }
    const t =
      typeof tag === 'string'
        ? Date.parse(tag.replace(' ', 'T') + (tag.endsWith('Z') ? '' : 'Z'))
        : NaN;
    const k = typeof kp === 'number' ? kp : Number(kp);
    if (!Number.isFinite(t) || !Number.isFinite(k)) continue;
    const kd = kind === 'observed' || kind === 'estimated' ? kind : 'predicted';
    out.push({ t, kp: k, kind: kd });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Kp for the 3-hour slot containing `now`, and the highest Kp in the next 24 h. */
export function kpSummary(
  points: KpPoint[],
  now: number,
): { now: KpPoint | null; max24: KpPoint | null } {
  let cur: KpPoint | null = null;
  let max24: KpPoint | null = null;
  for (const p of points) {
    if (p.t <= now) cur = p;
    if (p.t + 3 * 3600_000 > now && p.t <= now + 24 * 3600_000) {
      if (!max24 || p.kp > max24.kp) max24 = p;
    }
  }
  return { now: cur, max24 };
}

/** NOAA geomagnetic storm scale from Kp (G1 = Kp 5 … G5 = Kp 9). */
export function gScale(kp: number): string | null {
  if (kp >= 9) return 'G5 extreme storm';
  if (kp >= 8) return 'G4 severe storm';
  if (kp >= 7) return 'G3 strong storm';
  if (kp >= 6) return 'G2 moderate storm';
  if (kp >= 5) return 'G1 minor storm';
  return null;
}

export function kpWord(kp: number): string {
  return gScale(kp) ?? (kp >= 4 ? 'active' : kp >= 3 ? 'unsettled' : 'quiet');
}

export async function loadAurora(
  lat: number,
  lon: number,
  signal: AbortSignal,
  force = false,
): Promise<Cached<AuroraSite>> {
  const la = roundCoord(lat, 1);
  const lo = roundCoord(lon, 1);
  return fetchJson<AuroraSite, OvationRaw>(`aurora:${la},${lo}`, OVATION_URL, {
    maxAgeMs: force ? 0 : 15 * 60_000,
    signal,
    transform: (raw) => auroraForSite(raw, lat, lon),
  });
}

export async function loadKp(signal: AbortSignal, force = false): Promise<Cached<KpPoint[]>> {
  return fetchJson<KpPoint[], KpRaw>('kp', KP_URL, {
    maxAgeMs: force ? 0 : 60 * 60_000,
    signal,
    transform: parseKp,
  });
}
