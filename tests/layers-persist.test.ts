import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadLayers, mergeLayers, saveLayers } from '../src/lib/state/layers';

const DEF = {
  clouds: true,
  haze: true,
  terrain: true,
  constellations: true,
  satmap: false,
  lightpollution: true,
  surveys: false,
  survey: 'dss',
  surveyOpacity: 0.8,
  longExposure: false,
  deepSky: true,
};

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

describe('sky layer switches', () => {
  it('first visit gets the defaults; changes come back next visit', () => {
    expect(loadLayers(DEF)).toEqual(DEF);
    saveLayers({ ...DEF, constellations: false, surveys: true, survey: 'panstarrs' });
    expect(loadLayers(DEF)).toMatchObject({
      constellations: false,
      surveys: true,
      survey: 'panstarrs',
    });
  });

  it('never restores the satellite map (it opens another tab)', () => {
    saveLayers({ ...DEF, satmap: true });
    expect(loadLayers(DEF).satmap).toBe(false);
    expect(mergeLayers(DEF, { satmap: true }).satmap).toBe(false);
  });

  it('ignores bad or stale values', () => {
    expect(mergeLayers(DEF, { clouds: 'no', surveyOpacity: 7 })).toEqual(DEF);
    expect(mergeLayers(DEF, { survey: 'gone' }, (id) => id === 'dss').survey).toBe('dss');
    expect(mergeLayers(DEF, 'garbage')).toEqual(DEF);
    localStorage.setItem('anp.layers.v1', '{not json');
    expect(loadLayers(DEF)).toEqual(DEF);
  });
});
