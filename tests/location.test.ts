import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PLACE,
  PRESETS,
  effectiveSqm,
  hasChosenPlace,
  loadPlace,
  loadSiteSky,
  markPlaceChosen,
  savePlace,
  presetById,
  saveSiteSky,
  siteKey,
} from '../src/lib/location';

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

describe('locations', () => {
  it('defaults to Greenwich; built-in places are public observatories rounded to 0.01°', () => {
    expect(DEFAULT_PLACE.id).toBe('greenwich');
    expect(PRESETS.map((p) => p.id)).toEqual(['greenwich', 'mauna-kea', 'la-palma', 'paranal']);
    for (const p of PRESETS) {
      expect(Math.round(p.lat * 100) / 100).toBe(p.lat);
      expect(Math.round(p.lon * 100) / 100).toBe(p.lon);
    }
  });

  it('ships no personal site', () => {
    for (const id of ['bangalore', 'hanle', 'coorg']) expect(presetById(id)).toBeNull();
    expect(presetById('paranal')?.lat).toBeLessThan(0);
    expect(presetById('mauna-kea')?.timezone).toBe('Pacific/Honolulu');
  });

  it('first visit: default place and not chosen; a saved place comes back next visit', () => {
    expect(hasChosenPlace()).toBe(false);
    expect(loadPlace()).toEqual(DEFAULT_PLACE);
    const home = { name: 'Home', lat: 40.1, lon: -3.7, elevation: 650 };
    savePlace(home);
    expect(hasChosenPlace()).toBe(true);
    expect(loadPlace()).toEqual(home);
  });

  it('keeping the default place also counts as a choice', () => {
    markPlaceChosen();
    expect(hasChosenPlace()).toBe(true);
    expect(loadPlace().id).toBe('greenwich');
  });

  it('keys custom places by coordinates rounded to ~1 km', () => {
    expect(siteKey({ name: 'Roof', lat: 13.04123, lon: 77.56789, elevation: 900 })).toBe(
      '13.04,77.57',
    );
  });

  it('prefers the measured SQM over the model and says which it used', () => {
    expect(effectiveSqm(17.8, {})).toEqual({ sqm: 17.8, source: 'model' });
    expect(effectiveSqm(17.8, { sqmMeasured: 18.3 })).toEqual({ sqm: 18.3, source: 'measured' });
    expect(effectiveSqm(null, {})).toEqual({ sqm: null, source: 'none' });
  });

  it('stores measurements per site and rejects impossible values', () => {
    const roof = { name: 'Roof', lat: 13.04, lon: 77.57, elevation: 900 };
    saveSiteSky(roof, { sqmMeasured: 18.3, bortleMeasured: 9 });
    expect(loadSiteSky(roof).sqmMeasured).toBe(18.3);
    expect(loadSiteSky(DEFAULT_PLACE).sqmMeasured).toBeUndefined();
    saveSiteSky(roof, { sqmMeasured: 30 });
    expect(loadSiteSky(roof).sqmMeasured).toBeUndefined();
  });
});
