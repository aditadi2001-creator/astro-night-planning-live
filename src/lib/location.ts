import type { Place } from './astro/sky';

const KEY = 'anp.location.v1';
const SAVED_KEY = 'anp.savedLocations.v1';

/** Neutral default until the visitor shares or picks a location. */
export const DEFAULT_PLACE: Place = {
  name: 'Greenwich Observatory',
  lat: 51.4769,
  lon: -0.0005,
  elevation: 46,
};

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
