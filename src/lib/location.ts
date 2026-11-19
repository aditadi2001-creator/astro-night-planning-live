import type { Place } from './astro/sky';

const KEY = 'anp.location.v1';
const SAVED_KEY = 'anp.savedLocations.v1';
const SKY_KEY = 'anp.siteSky.v1';

/**
 * Built-in places. Coordinates are public landmarks rounded to 0.01° (DECISIONS D3):
 * the owner's precise site is entered on the device and never shipped.
 */
export const PRESETS: readonly Place[] = [
  {
    id: 'bangalore',
    name: 'Bangalore',
    detail: 'Karnataka, India',
    lat: 12.97,
    lon: 77.59,
    elevation: 920,
    timezone: 'Asia/Kolkata',
  },
  {
    id: 'hanle',
    name: 'Hanle',
    detail: 'Ladakh, India (dark-sky reserve)',
    lat: 32.78,
    lon: 78.96,
    elevation: 4500,
    timezone: 'Asia/Kolkata',
  },
  {
    id: 'coorg',
    name: 'Coorg (Madikeri)',
    detail: 'Karnataka, India',
    lat: 12.42,
    lon: 75.74,
    elevation: 1150,
    timezone: 'Asia/Kolkata',
  },
];

/** Default until the visitor picks or shares a location: Bangalore (rounded city centre). */
export const DEFAULT_PLACE: Place = PRESETS[0] as Place;

export function presetById(id: string): Place | null {
  return PRESETS.find((p) => p.id === id) ?? null;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or storage full: location simply won't persist.
  }
}

export function isValidPlace(p: unknown): p is Place {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.lat === 'number' &&
    typeof o.lon === 'number' &&
    Math.abs(o.lat) <= 90 &&
    Math.abs(o.lon) <= 180 &&
    typeof o.name === 'string'
  );
}

export function loadPlace(): Place {
  const p = readJson<Place>(KEY);
  return isValidPlace(p) ? { ...p, elevation: Number(p.elevation) || 0 } : DEFAULT_PLACE;
}

export function savePlace(p: Place): void {
  writeJson(KEY, p);
}

export function loadSavedPlaces(): Place[] {
  const list = readJson<unknown[]>(SAVED_KEY);
  return Array.isArray(list) ? list.filter(isValidPlace) : [];
}

export function saveSavedPlaces(list: Place[]): void {
  writeJson(SAVED_KEY, list.slice(0, 50));
}

/** Ask the browser for the visitor's position. Coordinates never leave the device except to data APIs. */
export function locateMe(): Promise<Place> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Geolocation is not available in this browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          name: 'My location',
          lat: round(pos.coords.latitude, 4),
          lon: round(pos.coords.longitude, 4),
          elevation: pos.coords.altitude != null ? Math.round(pos.coords.altitude) : 0,
          ...(pos.coords.altitude == null ? { needsElevation: true } : {}),
        }),
      (err) => reject(new Error(err.message || 'Location permission denied.')),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 },
    );
  });
}

function round(x: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

/**
 * What the user measured at a site (SQM meter, Bortle by eye), kept next to the
 * model's value so both can be shown and the measurement can calibrate the
 * scoring. Stored on this device only.
 */
export interface SiteSky {
  /** Measured zenith sky brightness, mag/arcsec² (SQM reading on a clear moonless night). */
  sqmMeasured?: number;
  /** Bortle class judged by the user (1–9). */
  bortleMeasured?: number;
  /** When the measurement was entered (ms). */
  measuredAt?: number;
  note?: string;
}

/** Key for per-site data: preset id, else coordinates rounded to ~1 km. */
export function siteKey(p: Place): string {
  return p.id ?? `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
}

export function loadSiteSky(p: Place): SiteSky {
  const all = readJson<Record<string, SiteSky>>(SKY_KEY) ?? {};
  return all[siteKey(p)] ?? {};
}

export function saveSiteSky(p: Place, v: SiteSky): void {
  const all = readJson<Record<string, SiteSky>>(SKY_KEY) ?? {};
  const clean: SiteSky = {};
  if (v.sqmMeasured != null && v.sqmMeasured >= 15 && v.sqmMeasured <= 22.5)
    clean.sqmMeasured = Math.round(v.sqmMeasured * 100) / 100;
  if (v.bortleMeasured != null && v.bortleMeasured >= 1 && v.bortleMeasured <= 9)
    clean.bortleMeasured = Math.round(v.bortleMeasured);
  if (v.note) clean.note = v.note.slice(0, 200);
  if (clean.sqmMeasured != null || clean.bortleMeasured != null) clean.measuredAt = Date.now();
  all[siteKey(p)] = clean;
  writeJson(SKY_KEY, all);
}

/**
 * Sky brightness to use for planning: the user's measurement when there is one,
 * otherwise the model. Returns which one was used, so the UI can say so.
 */
export function effectiveSqm(
  model: number | null,
  sky: SiteSky,
): { sqm: number | null; source: 'measured' | 'model' | 'none' } {
  if (sky.sqmMeasured != null) return { sqm: sky.sqmMeasured, source: 'measured' };
  if (model != null) return { sqm: model, source: 'model' };
  return { sqm: null, source: 'none' };
}
