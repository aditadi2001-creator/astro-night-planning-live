import { describe, expect, it } from 'vitest';
import { cellCloud, layerShare, renderClouds, type CloudInput } from '../src/lib/sky/clouds';

const W = 128;
const H = 32;
const SURFACE = 300;

function base(): CloudInput {
  const wind = { speed: 0, dir: 270 };
  return {
    center: { low: 0, mid: 0, high: 0 },
    samples: [],
    wind: { low: wind, mid: wind, high: wind },
    time: 0,
    color: { low: [10, 10, 10], mid: [10, 10, 10], high: [10, 10, 10] },
    width: W,
    height: H,
  };
}

/** 121×121 field: cloud with a ~4.6 km top (mid layer) from 10 km north of the site, clear elsewhere. */
function northField(): NonNullable<CloudInput['field']> {
  const n = 121;
  const bt = new Float32Array(n * n);
  for (let iy = 0; iy < n; iy++)
    for (let ix = 0; ix < n; ix++) bt[iy * n + ix] = iy > 62 ? SURFACE - 30 : SURFACE;
  return { n, stepKm: 5, bt, surfaceK: SURFACE, weight: 1, ageS: 0 };
}

/** Mean alpha (0–1) over a block of azimuth columns at a given altitude row. */
function alphaAt(img: Uint8ClampedArray, az0: number, az1: number, row: number): number {
  let s = 0;
  let k = 0;
  for (let i = Math.floor((az0 / 360) * W); i < Math.floor((az1 / 360) * W); i++) {
    s += img[(row * W + i) * 4 + 3] ?? 0;
    k++;
  }
  return s / k / 255;
}

describe('satellite cloud field in the sky', () => {
  it('turns brightness temperature into cloud fraction and top height', () => {
    expect(cellCloud(SURFACE, SURFACE).frac).toBe(0);
    expect(cellCloud(SURFACE - 20, SURFACE).frac).toBe(1);
    // 6.5 K per km: 13 K colder than the ground is a 2 km top.
    expect(cellCloud(SURFACE - 13, SURFACE).topKm).toBeCloseTo(2, 5);
    expect(layerShare(1)).toEqual([1, 0, 0]);
    expect(layerShare(5)).toEqual([0, 1, 0]);
    expect(layerShare(10)).toEqual([0, 0, 1]);
    const mixed = layerShare(3);
    expect(mixed[0] + mixed[1] + mixed[2]).toBeCloseTo(1, 10);
  });

  it('puts the clouds where the satellite saw them: north, not south', () => {
    const img = renderClouds({ ...base(), field: northField() });
    const row = Math.floor(H * (5 / 90)); // 5° up: the mid layer (4.5 km) is ~51 km away
    const north = (alphaAt(img, 330, 360, row) + alphaAt(img, 0, 30, row)) / 2;
    const south = alphaAt(img, 150, 210, row);
    expect(north).toBeGreaterThan(0.3);
    expect(south).toBeLessThan(0.02);
  });

  it('fades the field out with its weight', () => {
    const f = { ...northField(), weight: 0 };
    const img = renderClouds({ ...base(), field: f });
    expect(alphaAt(img, 0, 30, 7)).toBeLessThan(0.02);
  });
});

describe('light-pollution sky glow', () => {
  it('is brighter towards the horizon and absent without light pollution', () => {
    const lit = renderClouds({ ...base(), glow: { rgb: [128, 102, 86], zenithA: 0.2 } });
    const low = alphaAt(lit, 0, 360, 1); // ~1.4° up
    const zen = alphaAt(lit, 0, 360, H - 1); // ~88.6° up
    expect(zen).toBeCloseTo(0.2, 1);
    expect(low).toBeGreaterThan(zen * 1.8);
    const dark = renderClouds(base());
    expect(alphaAt(dark, 0, 360, H - 1)).toBe(0);
  });
});
