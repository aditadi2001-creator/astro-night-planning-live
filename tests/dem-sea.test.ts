import { describe, expect, it } from 'vitest';
import { sampleRaster, type Raster } from '../src/lib/sky/dem';

// A missing Copernicus tile is open sea. It must read 0 m only inside its own 1° square,
// otherwise every coastal site gets a flat sea-level horizon (bug fixed 2026-11-20).
const sea: Raster = { west: -156, north: 20, dx: 1, dy: 1, w: 1, h: 1, data: null };
const land: Raster = {
  west: -156,
  north: 21,
  dx: 0.5,
  dy: 0.5,
  w: 2,
  h: 2,
  data: Float32Array.from([1000, 1000, 1000, 1000]),
};

describe('DEM sampling near the sea', () => {
  it('a sea tile is 0 m inside its square and "not here" (NaN) outside it', () => {
    expect(sampleRaster(sea, 19.5, -155.5)).toBe(0);
    expect(sampleRaster(sea, 20.5, -155.5)).toBeNaN();
    expect(sampleRaster(sea, 19.5, -154.5)).toBeNaN();
  });

  it('a land tile listed after a sea tile is still found', () => {
    const at = (lat: number, lon: number) => {
      for (const r of [sea, land]) {
        const v = sampleRaster(r, lat, lon);
        if (Number.isFinite(v)) return v;
      }
      return Number.NaN;
    };
    expect(at(20.5, -155.5)).toBe(1000);
    expect(at(19.5, -155.5)).toBe(0);
  });
});
