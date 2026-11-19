import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PLACE,
  PRESETS,
  effectiveSqm,
  loadSiteSky,
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
  it('defaults to Bangalore, rounded to 0.01° (privacy)', () => {
    expect(DEFAULT_PLACE.id).toBe('bangalore');
    for (const p of PRESETS) {
      expect(Math.round(p.lat * 100) / 100).toBe(p.lat);
      expect(Math.round(p.lon * 100) / 100).toBe(p.lon);
    }
  });

  it('has the Hanle and Coorg presets', () => {
    expect(presetById('hanle')?.elevation).toBe(4500);
    expect(presetById('coorg')?.timezone).toBe('Asia/Kolkata');
    expect(presetById('nowhere')).toBeNull();
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
