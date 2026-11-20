import { describe, expect, it } from 'vitest';
import {
  binCentre,
  binFactors,
  DIST_BINS,
  distBin,
  hazeFactor,
  REF_AOD,
  weightedHaze,
} from '../src/lib/physics/hazeglow';
import {
  distanceWeights,
  withHaze,
  type LpModel,
  type SiteLight,
} from '../src/lib/lp/lightpollution';

describe('hazeFactor', () => {
  it('is 1 on the reference night', () => {
    for (const d of [0.5, 5, 50]) expect(hazeFactor(d, REF_AOD)).toBeCloseTo(1, 9);
  });

  it('brightens the sky near the lights and dims it far away in haze', () => {
    expect(hazeFactor(0.5, 0.5)).toBeCloseTo(1.78, 1);
    expect(hazeFactor(2, 0.5)).toBeGreaterThan(1);
    expect(hazeFactor(6, 0.5)).toBeLessThan(1);
    expect(hazeFactor(10, 0.5)).toBeCloseTo(0.38, 1);
    expect(hazeFactor(50, 0.5)).toBeLessThan(0.2);
  });

  it('does the opposite on a very clean night', () => {
    expect(hazeFactor(0.5, 0.05)).toBeLessThan(1);
    expect(hazeFactor(50, 0.05)).toBeGreaterThan(1.5);
  });

  it('grows with haze over a city, with diminishing returns', () => {
    const f = [0.1, 0.3, 0.6, 1.0].map((t) => hazeFactor(0.5, t));
    for (let i = 1; i < f.length; i++) expect(f[i]).toBeGreaterThan(f[i - 1] ?? 0);
    // Brightening per unit of AOD: 0.6→1.0 is weaker than 0.1→0.3 (extinction catches up).
    expect(((f[3] ?? 0) - (f[2] ?? 0)) / 0.4).toBeLessThan(((f[1] ?? 0) - (f[0] ?? 0)) / 0.2);
  });

  it('clamps out-of-range AOD', () => {
    expect(hazeFactor(1, 5)).toBe(hazeFactor(1, 1.5));
    expect(hazeFactor(1, -1)).toBe(hazeFactor(1, 0.02));
  });
});

describe('distance bins', () => {
  it('puts own lights in bin 0 and caps at 150 km', () => {
    expect(distBin(0)).toBe(0);
    expect(distBin(0.5)).toBe(0);
    expect(distBin(149.9)).toBe(DIST_BINS - 1);
    expect(distBin(1000)).toBe(DIST_BINS - 1);
  });

  it('has each bin centre inside its bin', () => {
    for (let k = 0; k < DIST_BINS; k++) expect(distBin(binCentre(k))).toBe(k);
  });

  it('weighs the factors by the light shares', () => {
    const near = Array.from({ length: DIST_BINS }, (_, k) => (k === 0 ? 1 : 0));
    expect(weightedHaze(near, 0.5)).toBeCloseTo(binFactors(0.5)[0] ?? 0, 9);
    expect(weightedHaze(new Array<number>(DIST_BINS).fill(0), 0.5)).toBe(1);
  });
});

describe('withHaze', () => {
  const nearOnly = Array.from({ length: DIST_BINS }, (_, k) => (k === 0 ? 1 : 0));
  const farOnly = Array.from({ length: DIST_BINS }, (_, k) => (k === DIST_BINS - 3 ? 1 : 0));
  const base: SiteLight = {
    year: 2025,
    sqm: 18.0,
    bortle: 8,
    brightening: 4.0,
    ratio: 10 ** 1.6 - 1,
    domes: [2, 1],
    typicalErrorMag: 0.35,
    validationN: 5345,
    naturalSqm: 22.0,
    zenithBins: nearOnly,
    domeBins: [...farOnly, ...nearOnly],
  };

  it('brightens a city sky on a hazy night, keeping Bortle and brightening', () => {
    const h = withHaze(base, 0.6);
    expect(h.haze).toBeGreaterThan(1.5);
    expect(h.sqm).toBeLessThan(18.0 - 0.4);
    expect(h.bortle).toBe(8);
    expect(h.brightening).toBe(4.0);
    expect(h.hazeAod).toBe(0.6);
  });

  it('dims a site lit only by distant towns', () => {
    const rural = { ...base, sqm: 21.0, ratio: 10 ** 0.4 - 1, zenithBins: farOnly };
    expect(withHaze(rural, 0.6).sqm).toBeGreaterThan(21.5);
  });

  it('corrects each light dome by where its light comes from', () => {
    const h = withHaze(base, 0.6);
    expect((h.domes[0] ?? 0) / 2).toBeLessThan(1); // far town fades
    expect(h.domes[1] ?? 0).toBeGreaterThan(1); // near lights brighten
  });

  it('leaves the light alone without haze data or for copies cached before the bins', () => {
    expect(withHaze(base, null)).toBe(base);
    const old = { ...base };
    delete old.zenithBins;
    expect(withHaze(old, 0.6)).toBe(old);
    expect(withHaze(base, REF_AOD).sqm).toBeCloseTo(18.0, 6);
  });
});

describe('distanceWeights', () => {
  const m: LpModel = { p: 2, d0Km: 0.5, DKm: 300, A: 0.056, rMaxKm: 150 };
  it('splits a site’s light into near and far shares that sum to 1', () => {
    const lat = 12.97;
    const lon = 77.59;
    const px = [
      { lat, lon, L: 50, areaKm2: 5 }, // own pixel
      { lat: lat + 0.45, lon, L: 50, areaKm2: 5 }, // ~50 km north
    ];
    const w = distanceWeights(px, lat, lon, m);
    expect(w.zenith.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2);
    expect(w.zenith[0]).toBeGreaterThan(0.99); // the own pixel dominates the zenith
    const northFar = w.domes.slice(0, DIST_BINS);
    expect(northFar[distBin(50)]).toBeGreaterThan(0.99); // the dome sees only the far town
  });
});
